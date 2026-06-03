import { DeploymentStatus, type Connection, type Environment, type Resource } from '@prisma/client';
import {
  ErrorCodes,
  type InjectConfig,
  resolveResourceBindingVars,
  resourceKindToSpec,
} from '@liftoff/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesService } from '../repositories/repositories.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { EnvironmentsService } from '../environments/environments.service';
import { AutoSetupDto } from './dto/auto-setup.dto';
import { SaveLayoutDto } from './dto/save-layout.dto';
import { AppException, Exceptions } from '../common/exceptions/app.exception';
import { Role } from '@prisma/client';

export interface CanvasNode {
  id: string;
  type: 'service' | 'database' | 'redis' | 'storage';
  position: { x: number; y: number };
  data: {
    label: string;
    environmentId: string;
    // Set on `service`-type nodes (Phase 1+). DB/redis/storage child nodes leave this empty.
    serviceId?: string;
    serviceKind?: 'SERVICE' | 'WORKER' | 'JOB' | 'STATIC_SITE';
    serviceName?: string;
    sourceDir?: string;
    routePath?: string | null;
    healthcheckPath?: string | null;
    command?: string | null;
    endpoint?: string;
    imageUri?: string;
    buildStrategy?: string;
    runtimeSummary?: string;
    region?: string;
    instanceSize?: string;
    replicas?: number;
    port?: number;
    status?: DeploymentStatus;
    databaseEngine?: 'postgres' | 'redis';
    hostname?: string;
    bucketName?: string;
    outputs?: Record<string, string>;
    lastDeployTime?: string;
    // Resource-node fields (database/redis/storage nodes backed by Resource rows).
    resourceId?: string;
    resourceKind?: string;
    resourceStatus?: string;
    resourceConfig?: Record<string, unknown>;
    isStaged?: boolean;
  };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  /** Env vars this edge auto-injects into the target service on deploy. */
  injectedVars?: string[];
  /** Short edge label, e.g. "DATABASE_URL" or "DATABASE_URL +2". */
  label?: string;
}

export interface CanvasState {
  projectId: string;
  projectName: string;
  hasConnectedRepo: boolean;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface AutoSetupResult {
  projectId: string;
  environmentId: string;
  deploymentId: string;
}

// Layout grid: services arranged horizontally; resource nodes without a saved
// position fall back to a slot below the first service of each env.
const SERVICE_BASE = { x: 400, y: 200 };
const SERVICE_X_STEP = 320;
const RESOURCE_FALLBACK_OFFSET = { dx: 320, dy: 200, dyStep: 140 } as const;

function isCanvasPosition(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { x?: unknown }).x === 'number' &&
    typeof (value as { y?: unknown }).y === 'number'
  );
}

/**
 * Handles canvas state retrieval and auto-setup for Railway-inspired canvas UI.
 */
@Injectable()
export class CanvasService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly repositoriesService: RepositoriesService,
    private readonly deploymentsService: DeploymentsService,
    private readonly environmentsService: EnvironmentsService,
  ) {}

  /**
   * Returns the enriched canvas state (nodes + edges + live status) for a project.
   *
   * Nodes come from real rows: one `service` node per Service, one resource node
   * (database/redis/storage) per Resource. Edges come from Connection rows — the
   * persisted graph, not derived from Pulumi outputs. Live deploy status is layered
   * onto service nodes from their latest deployment.
   */
  public async getCanvas(projectId: string, userId: string): Promise<CanvasState> {
    await this.projectsService.assertProjectRole(projectId, userId);

    const project = await this.prismaService.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: {
        id: true,
        name: true,
        repository: { select: { id: true } },
        environments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            doAccount: { select: { region: true } },
            services: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
              include: {
                deployments: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: {
                    id: true,
                    status: true,
                    imageUri: true,
                    buildStrategy: true,
                    endpoint: true,
                    updatedAt: true,
                    createdAt: true,
                  },
                },
              },
            },
            resourceNodes: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
            connections: true,
          },
        },
      },
    });

    if (!project) {
      throw Exceptions.notFound('Project not found', ErrorCodes.PROJECT_NOT_FOUND);
    }

    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];

    for (const env of project.environments) {
      const region = env.doAccount.region;
      // Track which node ids actually render this pass. Services are SOFT-deleted
      // (their Connection rows survive the FK cascade), so we must drop any edge
      // whose source/target node isn't live — otherwise getCanvas emits dangling
      // edges pointing at a node that no longer renders.
      const liveNodeIds = new Set<string>();
      const firstService = env.services[0] ?? null;
      const firstServicePosition: { x: number; y: number } =
        firstService && isCanvasPosition(firstService.canvasPosition)
          ? firstService.canvasPosition
          : { x: SERVICE_BASE.x, y: SERVICE_BASE.y };

      env.services.forEach((service, index) => {
        const latestDeployment = service.deployments[0];
        const position = isCanvasPosition(service.canvasPosition)
          ? service.canvasPosition
          : { x: SERVICE_BASE.x + index * SERVICE_X_STEP, y: SERVICE_BASE.y };

        liveNodeIds.add(service.id);
        nodes.push({
          id: service.id,
          type: 'service',
          position,
          data: {
            label: service.name,
            environmentId: env.id,
            serviceId: service.id,
            serviceKind: service.kind,
            serviceName: service.name,
            sourceDir: service.sourceDir,
            routePath: service.routePath,
            healthcheckPath: service.healthcheckPath,
            command: service.command,
            endpoint: latestDeployment?.endpoint ?? undefined,
            imageUri: latestDeployment?.imageUri ?? undefined,
            buildStrategy: latestDeployment?.buildStrategy ?? service.buildStrategy.toLowerCase(),
            runtimeSummary: `${service.instanceSize} • port ${service.port}`,
            region,
            instanceSize: service.instanceSize,
            replicas: service.replicas,
            port: service.port,
            status: latestDeployment?.status,
            lastDeployTime: latestDeployment?.updatedAt?.toISOString(),
          },
        });
      });

      // Resource nodes (managed Postgres / Redis / Spaces bucket) from Resource rows.
      env.resourceNodes.forEach((resource, index) => {
        const position = isCanvasPosition(resource.canvasPosition)
          ? resource.canvasPosition
          : {
              x: firstServicePosition.x + RESOURCE_FALLBACK_OFFSET.dx,
              y: firstServicePosition.y + RESOURCE_FALLBACK_OFFSET.dy + index * RESOURCE_FALLBACK_OFFSET.dyStep,
            };
        liveNodeIds.add(resource.id);
        nodes.push(this.toResourceNode(resource, env.id, position));
      });

      // Edges from Connection rows. Source = resource (binding) or service (link);
      // target is always the consumer service. Skip any edge whose endpoints aren't
      // both live nodes (e.g. a connection left behind by a soft-deleted service).
      const resourceById = new Map(env.resourceNodes.map((resource) => [resource.id, resource]));
      const serviceNameById = new Map(env.services.map((service) => [service.id, service.name]));
      for (const connection of env.connections) {
        const source = connection.sourceResourceId ?? connection.sourceServiceId;
        if (!source) {
          continue;
        }
        if (!liveNodeIds.has(source) || !liveNodeIds.has(connection.targetServiceId)) {
          continue;
        }
        const injectedVars = this.computeInjectedVars(connection, resourceById, serviceNameById);
        edges.push({
          id: connection.id,
          source,
          target: connection.targetServiceId,
          injectedVars,
          label: this.edgeLabel(injectedVars),
        });
      }
    }

    return {
      projectId: project.id,
      projectName: project.name,
      hasConnectedRepo: !!project.repository,
      nodes,
      edges,
    };
  }

  /**
   * Maps a Resource row to its canvas node, dispatching node type + display data
   * by kind. Only non-secret cached outputs are surfaced.
   */
  private toResourceNode(
    resource: Resource,
    environmentId: string,
    position: { x: number; y: number },
  ): CanvasNode {
    const outputs = (resource.outputs ?? undefined) as Record<string, string> | undefined;
    const base = {
      label: resource.name,
      environmentId,
      resourceId: resource.id,
      resourceKind: resource.kind,
      resourceStatus: resource.status,
      resourceConfig: (resource.config ?? undefined) as Record<string, unknown> | undefined,
      outputs,
    };

    if (resource.kind === 'REDIS') {
      return {
        id: resource.id,
        type: 'redis',
        position,
        data: { ...base, databaseEngine: 'redis', hostname: outputs?.host, port: 6379 },
      };
    }

    if (resource.kind === 'SPACES_BUCKET') {
      return {
        id: resource.id,
        type: 'storage',
        position,
        data: { ...base, bucketName: outputs?.bucketName },
      };
    }

    return {
      id: resource.id,
      type: 'database',
      position,
      data: {
        ...base,
        databaseEngine: 'postgres',
        hostname: outputs?.host ?? outputs?.clusterName,
        port: 5432,
      },
    };
  }

  /**
   * Names the env vars an edge auto-injects into its target service on deploy —
   * resolved via the same binding templates the Pulumi compiler uses, so the
   * canvas shows exactly what will be injected.
   */
  private computeInjectedVars(
    connection: Connection,
    resourceById: Map<string, Resource>,
    serviceNameById: Map<string, string>,
  ): string[] {
    if (connection.kind === 'RESOURCE_BINDING' && connection.sourceResourceId) {
      const resource = resourceById.get(connection.sourceResourceId);
      if (!resource) {
        return [];
      }
      const { vars } = resolveResourceBindingVars(
        resourceKindToSpec(resource.kind),
        connection.injectConfig as InjectConfig | null,
      );
      return Object.keys(vars);
    }

    if (connection.kind === 'SERVICE_LINK' && connection.sourceServiceId) {
      const sourceName = serviceNameById.get(connection.sourceServiceId);
      if (!sourceName) {
        return [];
      }
      return [`INTERNAL_${sourceName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL`];
    }

    return [];
  }

  private edgeLabel(injectedVars: string[]): string | undefined {
    if (injectedVars.length === 0) {
      return undefined;
    }
    const [first, ...rest] = injectedVars;
    return rest.length > 0 ? `${first} +${rest.length}` : first;
  }

  /**
   * Auto-setup: connects repo, uses provided environment, and triggers first deployment.
   */
  public async autoSetup(
    projectId: string,
    userId: string,
    dto: AutoSetupDto,
  ): Promise<AutoSetupResult> {
    await this.projectsService.assertProjectRole(projectId, userId, [Role.OWNER, Role.ADMIN]);

    const targetEnvironment = await this.resolveTargetEnvironment(projectId, userId, dto);
    const connectedRepo = await this.repositoriesService.findByProject(projectId, userId);
    let repoJustConnected = false;
    if (!connectedRepo) {
      await this.repositoriesService.connect(projectId, userId, {
        githubRepoId: dto.githubRepoId,
        fullName: dto.fullName,
        branch: targetEnvironment.gitBranch,
      } as Parameters<typeof this.repositoriesService.connect>[2]);
      repoJustConnected = true;
    }

    if (repoJustConnected) {
      const latestDeployment = await this.prismaService.deployment.findFirst({
        where: { environmentId: targetEnvironment.id },
        orderBy: { createdAt: 'desc' },
      });

      return {
        projectId,
        environmentId: targetEnvironment.id,
        deploymentId: latestDeployment?.id ?? '',
      };
    }

    const deployment = await this.deploymentsService.trigger(targetEnvironment.id, userId);

    return {
      projectId,
      environmentId: targetEnvironment.id,
      deploymentId: deployment.id,
    };
  }

  /**
   * Persists canvas node positions for both Service and Resource nodes.
   *
   * A node id is either a Service id or a Resource id (both real cuids now that
   * resources are first-class rows). We pre-resolve which ids are resources for
   * this project, then route each position to the right table. All updates are
   * scoped to non-deleted envs on this project so a spoofed/cross-project node id
   * can never write outside the caller's project.
   */
  public async saveLayout(projectId: string, userId: string, dto: SaveLayoutDto): Promise<void> {
    await this.projectsService.assertProjectRole(projectId, userId);

    const projectResources = await this.prismaService.resource.findMany({
      where: { environment: { projectId, deletedAt: null }, deletedAt: null },
      select: { id: true },
    });
    const resourceIds = new Set(projectResources.map((resource) => resource.id));

    for (const nodePos of dto.nodes) {
      const canvasPosition = { x: nodePos.x, y: nodePos.y };

      if (resourceIds.has(nodePos.id)) {
        await this.prismaService.resource.updateMany({
          where: { id: nodePos.id, environment: { projectId, deletedAt: null } },
          data: { canvasPosition },
        });
        continue;
      }

      await this.prismaService.service.updateMany({
        where: { id: nodePos.id, environment: { projectId, deletedAt: null } },
        data: { canvasPosition },
      });
    }
  }

  private async resolveTargetEnvironment(
    projectId: string,
    userId: string,
    dto: AutoSetupDto,
  ): Promise<Environment> {
    if (dto.environmentId) {
      const environment = await this.prismaService.environment.findFirst({
        where: { id: dto.environmentId, projectId, deletedAt: null },
      });
      if (!environment) {
        throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
      }

      return environment;
    }

    const existingEnvironment = await this.prismaService.environment.findFirst({
      where: { projectId, gitBranch: dto.branch, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (existingEnvironment) {
      return existingEnvironment;
    }

    const resolvedDoAccountId = await this.resolveDoAccountId(userId, dto.doAccountId);
    try {
      return await this.environmentsService.create(projectId, userId, {
        name: 'production',
        gitBranch: dto.branch,
        doAccountId: resolvedDoAccountId,
        serviceType: 'APP',
      });
    } catch (error) {
      if (
        error instanceof AppException &&
        error.getErrorCode() === ErrorCodes.ENVIRONMENT_NAME_TAKEN
      ) {
        const productionEnvironment = await this.prismaService.environment.findFirst({
          where: { projectId, name: 'production', deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        if (productionEnvironment) {
          return productionEnvironment;
        }
      }

      throw error;
    }
  }

  private async resolveDoAccountId(userId: string, preferredDoAccountId?: string): Promise<string> {
    if (preferredDoAccountId) {
      const selectedDoAccount = await this.prismaService.dOAccount.findFirst({
        where: { id: preferredDoAccountId, userId },
        select: { id: true },
      });
      if (!selectedDoAccount) {
        throw Exceptions.badRequest(
          'Selected DigitalOcean account does not belong to the current user',
          ErrorCodes.DO_ACCOUNT_NOT_FOUND,
        );
      }

      return selectedDoAccount.id;
    }

    const defaultValidatedDoAccount = await this.prismaService.dOAccount.findFirst({
      where: {
        userId,
        validatedAt: {
          not: null,
        },
      },
      orderBy: [{ validatedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });

    if (!defaultValidatedDoAccount) {
      throw Exceptions.badRequest(
        'No validated DigitalOcean account found. Connect and validate a DigitalOcean account to continue.',
        ErrorCodes.DO_ACCOUNT_NOT_FOUND,
      );
    }

    return defaultValidatedDoAccount.id;
  }
}
