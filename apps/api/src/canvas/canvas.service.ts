import { DeploymentStatus, type Deployment, type Environment, type ServiceType } from '@prisma/client';
import { ErrorCodes } from '@liftoff/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesService } from '../repositories/repositories.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { EnvironmentsService } from '../environments/environments.service';
import { AutoSetupDto } from './dto/auto-setup.dto';
import { SaveLayoutDto } from './dto/save-layout.dto';
import { Exceptions } from '../common/exceptions/app.exception';
import { Role } from '@prisma/client';

export interface CanvasNode {
  id: string;
  type: 'service' | 'database' | 'redis' | 'storage';
  position: { x: number; y: number };
  data: {
    label: string;
    environmentId: string;
    serviceName?: string;
    endpoint?: string;
    imageUri?: string;
    region?: string;
    instanceSize?: string;
    status?: DeploymentStatus;
    databaseEngine?: 'postgres' | 'redis';
    hostname?: string;
    port?: number;
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

interface EnvironmentWithDeployments {
  id: string;
  name: string;
  gitBranch: string;
  doAccountId: string;
  canvasPosition: { x: number; y: number } | null;
  deployments: Deployment[];
  pulumiStack: {
    outputs: Record<string, string> | null;
  } | null;
  doAccount: {
    region: string;
  };
}

const DEFAULT_POSITIONS = {
  service: { x: 400, y: 200 },
  database: { x: 680, y: 380 },
  redis: { x: 680, y: 520 },
  storage: { x: 680, y: 660 },
} as const;

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
   */
  public async getCanvas(projectId: string, userId: string): Promise<CanvasState> {
    await this.projectsService.assertProjectRole(projectId, userId);

    const project = await this.prismaService.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: {
        id: true,
        name: true,
        repository: {
          select: { id: true },
        },
        environments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            doAccount: { select: { region: true } },
            deployments: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            pulumiStack: {
              select: { outputs: true },
            },
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
      const envWithData = env as unknown as EnvironmentWithDeployments;
      const latestDeployment = envWithData.deployments[0];
      const canvasPos = envWithData.canvasPosition;
      const position: { x: number; y: number } = canvasPos !== null
        ? { x: canvasPos.x, y: canvasPos.y }
        : { x: DEFAULT_POSITIONS.service.x, y: DEFAULT_POSITIONS.service.y };

      nodes.push({
        id: env.id,
        type: 'service',
        position,
        data: {
          label: env.name,
          environmentId: env.id,
          serviceName: env.name,
          endpoint: latestDeployment?.endpoint ?? undefined,
          imageUri: latestDeployment?.imageUri ?? undefined,
          region: envWithData.doAccount.region,
          status: latestDeployment?.status,
          lastDeployTime: latestDeployment?.updatedAt?.toISOString(),
        },
      });

      if (envWithData.pulumiStack?.outputs) {
        const outputs = envWithData.pulumiStack.outputs as Record<string, string>;

        if (outputs.dbUri || outputs.databaseHost) {
          const dbOffset: { x: number; y: number } = canvasPos !== null
            ? { x: canvasPos.x + 280, y: canvasPos.y + 180 }
            : { x: DEFAULT_POSITIONS.database.x, y: DEFAULT_POSITIONS.database.y };
          nodes.push({
            id: `db-${env.id}`,
            type: 'database',
            position: dbOffset,
            data: {
              label: 'PostgreSQL',
              environmentId: env.id,
              databaseEngine: 'postgres',
              hostname: outputs.databaseHost ?? outputs.dbHost,
              port: outputs.databasePort ? parseInt(String(outputs.databasePort), 10) : 5432,
              outputs,
            },
          });

          edges.push({
            id: `edge-${env.id}-db`,
            source: env.id,
            target: `db-${env.id}`,
          });
        }

        if (outputs.redisUri || outputs.redisHost) {
          const redisOffset: { x: number; y: number } = canvasPos !== null
            ? { x: canvasPos.x + 280, y: canvasPos.y + 320 }
            : { x: DEFAULT_POSITIONS.redis.x, y: DEFAULT_POSITIONS.redis.y };
          nodes.push({
            id: `redis-${env.id}`,
            type: 'redis',
            position: redisOffset,
            data: {
              label: 'Redis',
              environmentId: env.id,
              databaseEngine: 'redis',
              hostname: outputs.redisHost ?? outputs.redisHost,
              port: outputs.redisPort ? parseInt(String(outputs.redisPort), 10) : 6379,
              outputs,
            },
          });

          edges.push({
            id: `edge-${env.id}-redis`,
            source: env.id,
            target: `redis-${env.id}`,
          });
        }

        if (outputs.bucketName || outputs.spacesBucket) {
          const storageOffset: { x: number; y: number } = canvasPos !== null
            ? { x: canvasPos.x + 280, y: canvasPos.y + 460 }
            : { x: DEFAULT_POSITIONS.storage.x, y: DEFAULT_POSITIONS.storage.y };
          nodes.push({
            id: `storage-${env.id}`,
            type: 'storage',
            position: storageOffset,
            data: {
              label: 'Spaces Bucket',
              environmentId: env.id,
              bucketName: outputs.bucketName ?? outputs.spacesBucket,
              outputs,
            },
          });

          edges.push({
            id: `edge-${env.id}-storage`,
            source: env.id,
            target: `storage-${env.id}`,
          });
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

    const connectedRepo = await this.repositoriesService.findByProject(projectId, userId);
    let repoJustConnected = false;
    if (!connectedRepo) {
      await this.repositoriesService.connect(projectId, userId, {
        githubRepoId: dto.githubRepoId,
        fullName: dto.fullName,
        branch: dto.branch,
      } as Parameters<typeof this.repositoriesService.connect>[2]);
      repoJustConnected = true;
    }

    let targetEnvironment: Environment | undefined;

    if (dto.environmentId) {
      const env = await this.prismaService.environment.findFirst({
        where: { id: dto.environmentId, projectId, deletedAt: null },
      });
      if (!env) {
        throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
      }
      targetEnvironment = env;
    } else {
      const environments = await this.environmentsService.findAll(projectId, userId);
      targetEnvironment = environments.find((env) => env.gitBranch === dto.branch) ?? environments[0];
    }

    if (!targetEnvironment) {
      throw Exceptions.badRequest('No environment found. Please create an environment first.');
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
   * Saves canvas node positions only.
   */
  public async saveLayout(projectId: string, userId: string, dto: SaveLayoutDto): Promise<void> {
    await this.projectsService.assertProjectRole(projectId, userId);

    for (const nodePos of dto.nodes) {
      if (nodePos.id.startsWith('db-') || nodePos.id.startsWith('redis-') || nodePos.id.startsWith('storage-')) {
        continue;
      }

      await this.prismaService.environment.updateMany({
        where: { id: nodePos.id, projectId },
        data: {
          canvasPosition: { x: nodePos.x, y: nodePos.y },
        },
      });
    }
  }
}
