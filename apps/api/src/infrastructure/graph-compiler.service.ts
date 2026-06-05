import { Connection, Resource, Service } from '@prisma/client';
import {
  BindingSpec,
  DEFAULT_RESOURCE_SIZE,
  DEFAULT_RESOURCE_VERSION,
  ErrorCodes,
  InjectConfig,
  type LiftoffConfigV2,
  ResourceSpec,
  resolveResourceBindingVars,
  resourceKindToSpec,
  safeParseLiftoffConfigV2,
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
  /**
   * LiftoffConfigV2 built FROM the env's Service rows — the authoritative
   * source of truth for what to deploy (services, ports, build, command, kind).
   * Replaces the stale stored configYaml at deploy time.
   */
  config: LiftoffConfigV2;
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
        orderBy: { createdAt: 'asc' },
      }),
      this.prismaService.resource.findMany({
        where: { environmentId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prismaService.connection.findMany({ where: { environmentId } }),
    ]);

    const config = this.compileConfig(services);
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
      config,
      resources: resourceSpecs,
      bindings,
      resourceIds: resources.map((resource) => resource.id),
    };
  }

  /**
   * Builds the deployable LiftoffConfigV2 from the env's Service rows — the
   * authoritative source of truth (replaces the stale stored configYaml). Maps
   * each row's kind/runtime/build/routes/command/job fields into the v2 schema
   * and validates the result so a bad row surfaces a clear error before deploy.
   */
  private compileConfig(services: Service[]): LiftoffConfigV2 {
    const raw = {
      version: '2.0',
      services: services.map((service) => ({
        name: service.name,
        type: service.kind.toLowerCase(),
        runtime: {
          instance_size: service.instanceSize,
          replicas: service.replicas,
          port: service.port,
        },
        build: {
          strategy: service.buildStrategy.toLowerCase(),
          dockerfile_path: service.dockerfilePath,
          context: service.sourceDir,
        },
        routes: service.routePath ? [{ path: service.routePath }] : [],
        ...(service.healthcheckPath ? { healthcheck: { path: service.healthcheckPath } } : {}),
        ...(service.command ? { command: service.command } : {}),
        ...(service.jobSchedule ? { schedule: service.jobSchedule } : {}),
        ...(service.jobKind ? { jobKind: service.jobKind } : {}),
        env: {},
        secrets: [],
      })),
    };

    const parsed = safeParseLiftoffConfigV2(raw);
    if (!parsed.success) {
      throw Exceptions.badRequest(
        `Could not compile environment config from services: ${parsed.errors
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
        ErrorCodes.CONFIG_VALIDATION_FAILED,
      );
    }
    return parsed.data;
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
