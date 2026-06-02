import { Connection, Resource } from '@prisma/client';
import {
  BindingSpec,
  DEFAULT_RESOURCE_SIZE,
  DEFAULT_RESOURCE_VERSION,
  ErrorCodes,
  InjectConfig,
  ResourceSpec,
  resolveResourceBindingVars,
  resourceKindToSpec,
  SERVICE_LINK_URL_TOKEN,
} from '@liftoff/shared';
import { Injectable } from '@nestjs/common';
import { Exceptions } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The compiled graph for an environment: what to provision and what to inject.
 * Plain JSON — safe to serialize into the Pulumi program.
 */
export interface CompiledGraph {
  resources: ResourceSpec[];
  bindings: BindingSpec[];
  /** Ids of the resources included — flipped to ACTIVE after a successful apply. */
  resourceIds: string[];
}

type ServiceLite = { id: string; name: string; port: number };

/**
 * Compiles the interactive graph (Service + Resource + Connection rows) into the
 * resource/binding descriptors the Pulumi program needs. The actual secret
 * resolution happens inside Pulumi from live outputs — this stage only produces
 * names, kinds, and env-var mappings. See INTERACTIVE_GRAPH_PLAN.md Phase B.
 */
@Injectable()
export class GraphCompilerService {
  public constructor(private readonly prismaService: PrismaService) {}

  public async compile(environmentId: string): Promise<CompiledGraph> {
    const [services, resources, connections] = await Promise.all([
      this.prismaService.service.findMany({
        where: { environmentId, deletedAt: null },
        select: { id: true, name: true, port: true },
      }),
      this.prismaService.resource.findMany({
        where: { environmentId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prismaService.connection.findMany({ where: { environmentId } }),
    ]);

    const serviceById = new Map<string, ServiceLite>(services.map((service) => [service.id, service]));
    const resourceById = new Map<string, Resource>(resources.map((resource) => [resource.id, resource]));

    const resourceSpecs = resources.map((resource) => this.toResourceSpec(resource));
    const bindings: BindingSpec[] = [];

    for (const connection of connections) {
      const targetService = serviceById.get(connection.targetServiceId);
      if (!targetService) {
        continue; // target soft-deleted — canvas drops this edge too
      }

      if (connection.kind === 'RESOURCE_BINDING' && connection.sourceResourceId) {
        const resource = resourceById.get(connection.sourceResourceId);
        if (!resource) {
          continue;
        }
        const kindSpec = resourceKindToSpec(resource.kind);
        const { vars, secretVars } = resolveResourceBindingVars(
          kindSpec,
          connection.injectConfig as InjectConfig | null,
        );
        bindings.push({
          kind: 'resource',
          sourceResourceName: resource.name,
          targetServiceName: targetService.name,
          vars,
          secretVars,
        });
      } else if (connection.kind === 'SERVICE_LINK' && connection.sourceServiceId) {
        const sourceService = serviceById.get(connection.sourceServiceId);
        if (!sourceService) {
          continue;
        }
        const envVarName = `INTERNAL_${sourceService.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL`;
        bindings.push({
          kind: 'service_link',
          sourceServiceName: sourceService.name,
          targetServiceName: targetService.name,
          vars: { [envVarName]: SERVICE_LINK_URL_TOKEN },
          secretVars: [],
        });
      }
    }

    // Reject service-link cycles — App Platform bakes internal URLs statically and
    // a cyclic graph has no valid resolution order.
    this.assertNoServiceLinkCycle(services, connections);

    return {
      resources: resourceSpecs,
      bindings,
      resourceIds: resources.map((resource) => resource.id),
    };
  }

  private toResourceSpec(resource: Resource): ResourceSpec {
    const kind = resourceKindToSpec(resource.kind);
    const config = (resource.config ?? {}) as { version?: string; size?: string };
    return {
      name: resource.name,
      kind,
      version: config.version ?? DEFAULT_RESOURCE_VERSION[kind],
      size: config.size ?? DEFAULT_RESOURCE_SIZE[kind],
    };
  }

  private assertNoServiceLinkCycle(services: ServiceLite[], connections: Connection[]): void {
    const adjacency = new Map<string, string[]>();
    for (const connection of connections) {
      if (
        connection.kind === 'SERVICE_LINK' &&
        connection.sourceServiceId &&
        connection.targetServiceId
      ) {
        const list = adjacency.get(connection.sourceServiceId) ?? [];
        list.push(connection.targetServiceId);
        adjacency.set(connection.sourceServiceId, list);
      }
    }

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();

    const visit = (node: string): boolean => {
      color.set(node, GRAY);
      for (const next of adjacency.get(node) ?? []) {
        const nextColor = color.get(next) ?? WHITE;
        if (nextColor === GRAY) {
          return true;
        }
        if (nextColor === WHITE && visit(next)) {
          return true;
        }
      }
      color.set(node, BLACK);
      return false;
    };

    for (const service of services) {
      if ((color.get(service.id) ?? WHITE) === WHITE && visit(service.id)) {
        throw Exceptions.badRequest(
          'Service links form a cycle — remove a link to break it',
          ErrorCodes.VALIDATION_ERROR,
        );
      }
    }
  }
}
