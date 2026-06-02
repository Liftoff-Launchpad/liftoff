import { InjectQueue } from '@nestjs/bullmq';
import { Deployment, DeploymentLog, DeploymentStatus, Role } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  ErrorCodes,
  PaginationQuery,
  PaginationQuerySchema,
  paginate,
} from '@liftoff/shared';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EventsGateway } from '../events/events.gateway';
import { Exceptions } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import {
  DeployJobPayload,
  JOB_NAMES,
  QUEUE_NAMES,
  QUEUE_TIMEOUTS,
  RollbackJobPayload,
} from '../queues/queue.constants';
import { TriggerDeploymentDto } from './dto/trigger-deployment.dto';

export interface DeploymentsListResponse {
  data: Deployment[];
  total: number;
}

/**
 * Handles deployment trigger/list/detail/rollback/cancel operations.
 */
@Injectable()
export class DeploymentsService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly eventsGateway: EventsGateway,
    @InjectQueue(QUEUE_NAMES.DEPLOYMENTS)
    private readonly deploymentsQueue: Queue<DeployJobPayload | RollbackJobPayload>,
  ) {}

  /**
   * Creates and queues a deployment for an environment.
   */
  public async trigger(
    environmentId: string,
    userId: string,
    dto?: TriggerDeploymentDto,
  ): Promise<Deployment> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId, [Role.OWNER, Role.ADMIN]);
    await this.assertNoActiveDeployment(environment.id);

    const imageUri = dto?.imageUri ?? (await this.resolveLatestDeployableImage(environment.id));
    if (!imageUri) {
      throw Exceptions.badRequest(
        'No deployable image is available for this environment',
        ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND,
      );
    }

    const deployment = await this.prismaService.deployment.create({
      data: {
        environmentId: environment.id,
        status: DeploymentStatus.PENDING,
        commitSha: dto?.commitSha ?? null,
        commitMessage: dto?.commitMessage ?? null,
        branch: dto?.branch ?? environment.gitBranch,
        imageUri,
        triggeredBy: userId,
      },
    });

    await this.deploymentsQueue.add(
      JOB_NAMES.DEPLOYMENTS.DEPLOY,
      {
        deploymentId: deployment.id,
        environmentId: environment.id,
        commitSha: deployment.commitSha ?? undefined,
      },
      {
        jobId: deployment.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      } as Parameters<Queue<DeployJobPayload | RollbackJobPayload>['add']>[2] & { timeout: number },
    );

    const queuedDeployment = await this.prismaService.deployment.update({
      where: {
        id: deployment.id,
      },
      data: {
        status: DeploymentStatus.QUEUED,
      },
    });

    this.eventsGateway.broadcastDeploymentStatus({
      deploymentId: queuedDeployment.id,
      status: DeploymentStatus.QUEUED,
      timestamp: new Date().toISOString(),
    });

    return queuedDeployment;
  }

  /**
   * Lists deployments for an environment with pagination.
   */
  public async findAll(
    environmentId: string,
    userId: string,
    query: PaginationQuery,
  ): Promise<DeploymentsListResponse> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId);

    const normalizedQuery = PaginationQuerySchema.parse(query);
    const { skip, take } = paginate(normalizedQuery);

    const [data, total] = await this.prismaService.$transaction([
      this.prismaService.deployment.findMany({
        where: { environmentId: environment.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prismaService.deployment.count({
        where: { environmentId: environment.id },
      }),
    ]);

    return {
      data,
      total,
    };
  }

  /**
   * Returns one deployment by ID.
   */
  public async findOne(environmentId: string, deploymentId: string, userId: string): Promise<Deployment> {
    const deployment = await this.getDeploymentContext(environmentId, deploymentId);
    await this.projectsService.assertProjectRole(deployment.projectId, userId);
    return deployment.deployment;
  }

  /**
   * Queues a rollback deployment based on a previous successful deployment.
   */
  public async rollback(
    targetDeploymentId: string,
    userId: string,
    environmentId?: string,
  ): Promise<Deployment> {
    const targetDeployment = await this.prismaService.deployment.findFirst({
      where: { id: targetDeploymentId },
      select: {
        id: true,
        environmentId: true,
        status: true,
        imageUri: true,
        commitSha: true,
        branch: true,
        environment: {
          select: {
            projectId: true,
          },
        },
      },
    });

    if (!targetDeployment) {
      throw Exceptions.notFound('Deployment not found', ErrorCodes.DEPLOYMENT_NOT_FOUND);
    }

    if (environmentId && targetDeployment.environmentId !== environmentId) {
      throw Exceptions.badRequest('Deployment does not belong to the target environment', ErrorCodes.VALIDATION_ERROR);
    }

    await this.projectsService.assertProjectRole(targetDeployment.environment.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    if (targetDeployment.status !== DeploymentStatus.SUCCESS || !targetDeployment.imageUri) {
      throw Exceptions.badRequest(
        'Rollback target must be a successful deployment with an image',
        ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND,
      );
    }

    await this.assertNoActiveDeployment(targetDeployment.environmentId);

    const rollbackDeployment = await this.prismaService.deployment.create({
      data: {
        environmentId: targetDeployment.environmentId,
        status: DeploymentStatus.PENDING,
        imageUri: targetDeployment.imageUri,
        commitSha: targetDeployment.commitSha ?? null,
        branch: targetDeployment.branch ?? null,
        commitMessage: this.buildRollbackMessage(targetDeployment.commitSha),
        triggeredBy: userId,
      },
    });

    await this.deploymentsQueue.add(
      JOB_NAMES.DEPLOYMENTS.ROLLBACK,
      {
        deploymentId: rollbackDeployment.id,
        targetDeploymentId: targetDeployment.id,
      },
      {
        jobId: rollbackDeployment.id,
        attempts: 1,
        timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      } as Parameters<Queue<DeployJobPayload | RollbackJobPayload>['add']>[2] & { timeout: number },
    );

    const queuedDeployment = await this.prismaService.deployment.update({
      where: {
        id: rollbackDeployment.id,
      },
      data: {
        status: DeploymentStatus.QUEUED,
      },
    });

    this.eventsGateway.broadcastDeploymentStatus({
      deploymentId: queuedDeployment.id,
      status: DeploymentStatus.QUEUED,
      timestamp: new Date().toISOString(),
    });

    return queuedDeployment;
  }

  /**
   * Returns persisted deployment logs in timestamp order.
   */
  public async getDeploymentLogs(
    environmentId: string,
    deploymentId: string,
    userId: string,
  ): Promise<DeploymentLog[]> {
    const deployment = await this.getDeploymentContext(environmentId, deploymentId);
    await this.projectsService.assertProjectRole(deployment.projectId, userId);

    return this.prismaService.deploymentLog.findMany({
      where: { deploymentId: deployment.deployment.id },
      orderBy: { timestamp: 'asc' },
    });
  }

  /**
   * Returns the most recent deployment for the given service along with its
   * persisted logs (build + pulumi). Used by the drawer to show users the
   * actual build error when a service is in FAILED state — without making
   * them navigate to the GitHub Actions tab.
   *
   * Returns `null` when the service has never been deployed.
   */
  public async getLatestServiceDeployment(
    environmentId: string,
    serviceName: string,
    userId: string,
  ): Promise<{ deployment: Deployment; logs: DeploymentLog[] } | null> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId);

    const service = await this.prismaService.service.findFirst({
      where: { environmentId: environment.id, name: serviceName, deletedAt: null },
      select: { id: true },
    });
    if (!service) {
      return null;
    }

    const deployment = await this.prismaService.deployment.findFirst({
      where: { environmentId: environment.id, serviceId: service.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!deployment) {
      return null;
    }

    const logs = await this.prismaService.deploymentLog.findMany({
      where: { deploymentId: deployment.id },
      orderBy: { timestamp: 'asc' },
    });

    return { deployment, logs };
  }

  /**
   * Cancels a pending or queued deployment.
   */
  public async cancel(
    environmentId: string,
    deploymentId: string,
    userId: string,
  ): Promise<Deployment> {
    const deployment = await this.getDeploymentContext(environmentId, deploymentId);
    await this.projectsService.assertProjectRole(deployment.projectId, userId, [Role.OWNER, Role.ADMIN]);

    if (
      deployment.deployment.status !== DeploymentStatus.PENDING &&
      deployment.deployment.status !== DeploymentStatus.QUEUED
    ) {
      throw Exceptions.badRequest(
        'Only pending or queued deployments can be cancelled',
        ErrorCodes.DEPLOYMENT_ALREADY_RUNNING,
      );
    }

    try {
      await this.deploymentsQueue.remove(deployment.deployment.id);
    } catch {
      // Job may already be active/removed. The deployment status update remains authoritative.
    }

    const cancelledDeployment = await this.prismaService.deployment.update({
      where: { id: deployment.deployment.id },
      data: {
        status: DeploymentStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    this.eventsGateway.broadcastDeploymentStatus({
      deploymentId: cancelledDeployment.id,
      status: DeploymentStatus.CANCELLED,
      timestamp: new Date().toISOString(),
    });
    this.eventsGateway.broadcastDeploymentComplete({
      deploymentId: cancelledDeployment.id,
      status: DeploymentStatus.CANCELLED,
    });

    return cancelledDeployment;
  }

  private async getEnvironmentContext(environmentId: string): Promise<{
    id: string;
    projectId: string;
    gitBranch: string;
  }> {
    const environment = await this.prismaService.environment.findFirst({
      where: {
        id: environmentId,
        deletedAt: null,
      },
      select: {
        id: true,
        projectId: true,
        gitBranch: true,
      },
    });

    if (!environment) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }

    return environment;
  }

  private async getDeploymentContext(
    environmentId: string,
    deploymentId: string,
  ): Promise<{
    deployment: Deployment;
    projectId: string;
  }> {
    const deployment = await this.prismaService.deployment.findFirst({
      where: {
        id: deploymentId,
        environmentId,
      },
      include: {
        environment: {
          select: {
            projectId: true,
          },
        },
      },
    });

    if (!deployment) {
      throw Exceptions.notFound('Deployment not found', ErrorCodes.DEPLOYMENT_NOT_FOUND);
    }

    const { environment, ...deploymentRecord } = deployment;
    return { deployment: deploymentRecord, projectId: environment.projectId };
  }

  private async assertNoActiveDeployment(environmentId: string): Promise<void> {
    const activeDeployment = await this.prismaService.deployment.findFirst({
      where: {
        environmentId,
        status: {
          in: ACTIVE_STATUSES as DeploymentStatus[],
        },
      },
      select: {
        id: true,
      },
    });

    if (activeDeployment) {
      throw Exceptions.conflict(
        'Another deployment is already in progress for this environment',
        ErrorCodes.DEPLOYMENT_ALREADY_RUNNING,
      );
    }
  }

  private async resolveLatestDeployableImage(environmentId: string): Promise<string | null> {
    const latestDeploymentWithImage = await this.prismaService.deployment.findFirst({
      where: {
        environmentId,
        imageUri: {
          not: null,
        },
        status: {
          in: [DeploymentStatus.SUCCESS, DeploymentStatus.ROLLED_BACK],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        imageUri: true,
      },
    });

    return latestDeploymentWithImage?.imageUri ?? null;
  }

  private buildRollbackMessage(commitSha: string | null): string {
    if (!commitSha) {
      return 'Rollback deployment';
    }

    return `Rollback to ${commitSha.slice(0, 7)}`;
  }
}
