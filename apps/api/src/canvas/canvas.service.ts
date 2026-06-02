import {
  DeploymentStatus,
  type Deployment,
  type Environment,
  type Service,
  type ServiceType,
} from '@prisma/client';
import { ErrorCodes } from '@liftoff/shared';
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
  };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
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

type EnvironmentWithServices = {
  id: string;
  name: string;
  gitBranch: string;
  doAccountId: string;
  doAccount: { region: string };
  services: Array<
    Service & {
      deployments: Array<Pick<
        Deployment,
        'id' | 'status' | 'imageUri' | 'buildStrategy' | 'endpoint' | 'updatedAt' | 'createdAt'
      >>;
    }
  >;
  pulumiStack: {
    outputs: Record<string, string> | null;
  } | null;
};

// Layout grid: services arranged horizontally; child resources (DB/Redis/Spaces)
// hang off the first service of each env.
const SERVICE_BASE = { x: 400, y: 200 };
const SERVICE_X_STEP = 320;
const CHILD_RESOURCE_OFFSETS = {
  database: { dx: 280, dy: 180 },
  redis: { dx: 280, dy: 320 },
  storage: { dx: 280, dy: 460 },
} as const;

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
   * Each Service row becomes one `service`-type node; per-env Pulumi outputs
   * (Managed Postgres, Spaces bucket, etc.) hang off the FIRST service of their env.
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
            name: true,
            gitBranch: true,
            doAccountId: true,
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
            pulumiStack: { select: { outputs: true } },
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
      const envWithData = env as unknown as EnvironmentWithServices;
      // Compute first-service anchor up-front (used to position env-scoped child resources
      // like the Pulumi-provisioned Postgres/Spaces). Computing inside the loop and via a
      // closure trips TypeScript's narrowing across function boundaries.
      const firstService = envWithData.services[0] ?? null;
      const firstServiceId: string | null = firstService?.id ?? null;
      const firstServicePosition: { x: number; y: number } | null = firstService
        ? isCanvasPosition(firstService.canvasPosition)
          ? firstService.canvasPosition
          : { x: SERVICE_BASE.x, y: SERVICE_BASE.y }
        : null;

      envWithData.services.forEach((service, index) => {
        const latestDeployment = service.deployments[0];
        const position = isCanvasPosition(service.canvasPosition)
          ? service.canvasPosition
          : { x: SERVICE_BASE.x + index * SERVICE_X_STEP, y: SERVICE_BASE.y };

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
            endpoint: latestDeployment?.endpoint ?? undefined,
            imageUri: latestDeployment?.imageUri ?? undefined,
            buildStrategy: latestDeployment?.buildStrategy ?? service.buildStrategy.toLowerCase(),
            runtimeSummary: `${service.instanceSize} • port ${service.port}`,
            region: envWithData.doAccount.region,
            instanceSize: service.instanceSize,
            replicas: service.replicas,
            port: service.port,
            status: latestDeployment?.status,
            lastDeployTime: latestDeployment?.updatedAt?.toISOString(),
          },
        });
      });

      // Pulumi-provisioned env resources (postgres, redis, spaces) hang off the first service.
      const pulumiOutputs = envWithData.pulumiStack?.outputs ?? null;
      if (pulumiOutputs && firstServiceId !== null && firstServicePosition !== null) {
        const anchor = firstServicePosition;
        const outputs = pulumiOutputs as Record<string, string>;

        if (outputs.dbUri || outputs.databaseHost) {
          const dbNodeId = `db-${env.id}`;
          nodes.push({
            id: dbNodeId,
            type: 'database',
            position: {
              x: anchor.x + CHILD_RESOURCE_OFFSETS.database.dx,
              y: anchor.y + CHILD_RESOURCE_OFFSETS.database.dy,
            },
            data: {
              label: 'PostgreSQL',
              environmentId: env.id,
              databaseEngine: 'postgres',
              hostname: outputs.databaseHost ?? outputs.dbHost,
              port: outputs.databasePort ? parseInt(String(outputs.databasePort), 10) : 5432,
              outputs,
            },
          });
          edges.push({ id: `edge-${env.id}-db`, source: firstServiceId, target: dbNodeId });
        }

        if (outputs.redisUri || outputs.redisHost) {
          const redisNodeId = `redis-${env.id}`;
          nodes.push({
            id: redisNodeId,
            type: 'redis',
            position: {
              x: anchor.x + CHILD_RESOURCE_OFFSETS.redis.dx,
              y: anchor.y + CHILD_RESOURCE_OFFSETS.redis.dy,
            },
            data: {
              label: 'Redis',
              environmentId: env.id,
              databaseEngine: 'redis',
              hostname: outputs.redisHost,
              port: outputs.redisPort ? parseInt(String(outputs.redisPort), 10) : 6379,
              outputs,
            },
          });
          edges.push({ id: `edge-${env.id}-redis`, source: firstServiceId, target: redisNodeId });
        }

        if (outputs.bucketName || outputs.spacesBucket) {
          const storageNodeId = `storage-${env.id}`;
          nodes.push({
            id: storageNodeId,
            type: 'storage',
            position: {
              x: anchor.x + CHILD_RESOURCE_OFFSETS.storage.dx,
              y: anchor.y + CHILD_RESOURCE_OFFSETS.storage.dy,
            },
            data: {
              label: 'Spaces Bucket',
              environmentId: env.id,
              bucketName: outputs.bucketName ?? outputs.spacesBucket,
              outputs,
            },
          });
          edges.push({ id: `edge-${env.id}-storage`, source: firstServiceId, target: storageNodeId });
        }
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
   * Persists canvas node positions for the project's Service rows.
   *
   * Child resource nodes (DB/Redis/Spaces with `db-`/`redis-`/`storage-` prefixes)
   * are derived from Pulumi outputs; their positions are computed from the first
   * service's position and not stored independently.
   */
  public async saveLayout(projectId: string, userId: string, dto: SaveLayoutDto): Promise<void> {
    await this.projectsService.assertProjectRole(projectId, userId);

    for (const nodePos of dto.nodes) {
      if (
        nodePos.id.startsWith('db-') ||
        nodePos.id.startsWith('redis-') ||
        nodePos.id.startsWith('storage-')
      ) {
        continue;
      }

      // Service rows are env-scoped, env is project-scoped — restrict the update
      // to services belonging to a non-deleted env on this project so cross-project
      // writes are impossible even if a node id is spoofed client-side.
      await this.prismaService.service.updateMany({
        where: {
          id: nodePos.id,
          environment: { projectId, deletedAt: null },
        },
        data: {
          canvasPosition: { x: nodePos.x, y: nodePos.y },
        },
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
