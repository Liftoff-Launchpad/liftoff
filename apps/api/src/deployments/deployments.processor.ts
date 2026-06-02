import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { DeploymentStatus, LogLevel, Prisma } from '@prisma/client';
import { DeploymentStatusType, ErrorCodes } from '@liftoff/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { Exceptions } from '../common/exceptions/app.exception';
import { EncryptionService } from '../common/services/encryption.service';
import { DOApp, DoApiService } from '../do-api/do-api.service';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  DeployJobPayload,
  JOB_NAMES,
  QUEUE_NAMES,
  QUEUE_TIMEOUTS,
  RollbackJobPayload,
} from '../queues/queue.constants';

type DeploymentExecutionContext = Prisma.DeploymentGetPayload<{
  include: {
    environment: {
      select: {
        id: true;
        projectId: true;
        doAccountId: true;
        doAccount: {
          select: {
            doToken: true;
          };
        };
        pulumiStack: {
          select: {
            outputs: true;
          };
        };
      };
    };
  };
}>;

interface AppDeploymentContext {
  appId: string;
  appUrl: string;
}

interface ParsedImageUri {
  registry: string;
  repository: string;
  tag: string;
}

interface AppDeployCycleResult {
  doDeploymentId: string;
  outcome: 'ACTIVE' | 'ERROR' | 'TIMEOUT';
}

/**
 * Processes deployment and rollback queue jobs.
 */
@Injectable()
@Processor(QUEUE_NAMES.DEPLOYMENTS)
export class DeploymentProcessor extends WorkerHost {
  private readonly logger = new Logger(DeploymentProcessor.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly doApiService: DoApiService,
    private readonly eventsGateway: EventsGateway,
    @InjectQueue(QUEUE_NAMES.DEPLOYMENTS)
    private readonly deploymentsQueue: Queue<DeployJobPayload | RollbackJobPayload>,
  ) {
    super();
  }

  /**
   * Routes queue jobs to deploy or rollback handlers.
   */
  public async process(job: Job, _token?: string): Promise<void> {
    if (job.name === JOB_NAMES.DEPLOYMENTS.DEPLOY) {
      await this.handleDeploy(job as Job<DeployJobPayload>);
      return;
    }

    if (job.name === JOB_NAMES.DEPLOYMENTS.ROLLBACK) {
      await this.handleRollback(job as Job<RollbackJobPayload>);
      return;
    }

    this.logger.warn(`Ignoring unsupported deployment job: ${job.name}`);
  }

  /**
   * Runs App Platform deploy for an image-ready deployment.
   *
   * Multi-service: when `bundleId` is set, builds the App Platform spec with
   * patches for EVERY sibling deployment's image at once (one atomic updateApp).
   * Single-service: existing single-deployment behaviour.
   */
  private async handleDeploy(job: Job<DeployJobPayload>): Promise<void> {
    const deployment = await this.getDeploymentOrThrow(job.data.deploymentId);

    if (!deployment.imageUri) {
      await this.markBuildPushProgress(deployment);
      return;
    }

    const appContext = this.resolveAppContext(deployment.environment.pulumiStack?.outputs ?? null);
    if (!appContext) {
      await this.failDeployment(deployment.id, 'App Platform outputs are missing for this environment');
      throw Exceptions.badRequest('Environment infrastructure is not ready', ErrorCodes.DEPLOYMENT_NO_INFRA);
    }

    const doToken = this.decryptDoToken(deployment.environment.doAccount.doToken);

    // Resolve the set of image URIs to apply atomically — all bundle siblings,
    // or just this deployment for single-service / manual triggers.
    const bundleImages = job.data.bundleId
      ? await this.resolveBundleImageUris(job.data.bundleId)
      : [deployment.imageUri];
    const affectedDeploymentIds = job.data.bundleId
      ? (
          await this.prismaService.deployment.findMany({
            where: { bundleId: job.data.bundleId },
            select: { id: true },
          })
        ).map((d) => d.id)
      : [deployment.id];

    await this.prismaService.deployment.updateMany({
      where: { id: { in: affectedDeploymentIds } },
      data: {
        status: DeploymentStatus.DEPLOYING,
        startedAt: deployment.startedAt ?? new Date(),
        errorMessage: null,
      },
    });
    for (const deploymentId of affectedDeploymentIds) {
      this.broadcastDeploymentStatus(deploymentId, DeploymentStatus.DEPLOYING);
    }

    let deployCycleResult: AppDeployCycleResult;
    try {
      deployCycleResult = await this.deployImagesToApp(
        doToken,
        deployment.environment.doAccountId,
        appContext,
        bundleImages,
      );
    } catch (error) {
      const errorMessage = this.sanitizeErrorMessage(this.resolveErrorMessage(error));
      await this.failBundleOrDeployment(affectedDeploymentIds, errorMessage);
      await this.queueAutoRollback(deployment.id, deployment.environmentId);
      throw error;
    }

    if (deployCycleResult.outcome === 'ACTIVE') {
      await this.prismaService.deployment.updateMany({
        where: { id: { in: affectedDeploymentIds } },
        data: {
          status: DeploymentStatus.SUCCESS,
          endpoint: appContext.appUrl,
          errorMessage: null,
          completedAt: new Date(),
        },
      });
      if (job.data.bundleId) {
        await this.prismaService.deploymentBundle.update({
          where: { id: job.data.bundleId },
          data: { status: 'SUCCESS', completedAt: new Date() },
        });
      }
      for (const deploymentId of affectedDeploymentIds) {
        this.broadcastDeploymentStatus(deploymentId, DeploymentStatus.SUCCESS);
        this.eventsGateway.broadcastDeploymentComplete({
          deploymentId,
          status: DeploymentStatus.SUCCESS as DeploymentStatusType,
          endpoint: appContext.appUrl,
        });
      }
      return;
    }

    await this.attachRunLogs(
      doToken,
      deployment.environment.doAccountId,
      appContext.appId,
      deployCycleResult.doDeploymentId,
      deployment.id,
    );

    const errorMessage =
      deployCycleResult.outcome === 'TIMEOUT'
        ? 'App Platform deployment timed out'
        : 'App Platform deployment failed';
    await this.failBundleOrDeployment(affectedDeploymentIds, errorMessage);
    await this.queueAutoRollback(deployment.id, deployment.environmentId);
  }

  /**
   * Returns the imageUri for every deployment in the bundle, in the order the
   * App Platform spec patcher should apply them. Skips rows that somehow lost
   * their image (defensive — finalizeBundleIfReady gates on full coverage).
   */
  private async resolveBundleImageUris(bundleId: string): Promise<string[]> {
    const deployments = await this.prismaService.deployment.findMany({
      where: { bundleId },
      select: { imageUri: true },
    });
    return deployments
      .map((d) => d.imageUri)
      .filter((uri): uri is string => Boolean(uri));
  }

  /**
   * Marks a set of deployments FAILED and propagates the bundle status when
   * the failed set covers a whole bundle.
   */
  private async failBundleOrDeployment(
    deploymentIds: string[],
    errorMessage: string,
  ): Promise<void> {
    await this.prismaService.deployment.updateMany({
      where: { id: { in: deploymentIds } },
      data: {
        status: DeploymentStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
      },
    });
    for (const deploymentId of deploymentIds) {
      this.broadcastDeploymentStatus(deploymentId, DeploymentStatus.FAILED);
      this.eventsGateway.broadcastDeploymentComplete({
        deploymentId,
        status: DeploymentStatus.FAILED as DeploymentStatusType,
      });
    }
  }

  /**
   * Runs rollback by deploying the target deployment image.
   */
  private async handleRollback(job: Job<RollbackJobPayload>): Promise<void> {
    const deployment = await this.getDeploymentOrThrow(job.data.deploymentId);
    const targetDeployment = await this.resolveRollbackTarget(deployment.environmentId, job.data.targetDeploymentId);

    if (!targetDeployment?.imageUri) {
      await this.failDeployment(deployment.id, 'Rollback target image was not found');
      throw Exceptions.notFound('Rollback target deployment image not found', ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND);
    }

    const appContext = this.resolveAppContext(deployment.environment.pulumiStack?.outputs ?? null);
    if (!appContext) {
      await this.failDeployment(deployment.id, 'App Platform outputs are missing for this environment');
      throw Exceptions.badRequest('Environment infrastructure is not ready', ErrorCodes.DEPLOYMENT_NO_INFRA);
    }

    const doToken = this.decryptDoToken(deployment.environment.doAccount.doToken);
    await this.prismaService.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.ROLLING_BACK,
        startedAt: deployment.startedAt ?? new Date(),
        errorMessage: null,
      },
    });
    this.broadcastDeploymentStatus(deployment.id, DeploymentStatus.ROLLING_BACK);

    let deployCycleResult: AppDeployCycleResult;
    try {
      deployCycleResult = await this.deployImagesToApp(
        doToken,
        deployment.environment.doAccountId,
        appContext,
        [targetDeployment.imageUri],
      );
    } catch (error) {
      const errorMessage = this.sanitizeErrorMessage(this.resolveErrorMessage(error));
      await this.failDeployment(deployment.id, errorMessage);
      throw error;
    }

    if (deployCycleResult.outcome === 'ACTIVE') {
      await this.prismaService.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.ROLLED_BACK,
          imageUri: targetDeployment.imageUri,
          endpoint: appContext.appUrl,
          errorMessage: null,
          completedAt: new Date(),
        },
      });
      this.broadcastDeploymentStatus(deployment.id, DeploymentStatus.ROLLED_BACK);
      this.eventsGateway.broadcastDeploymentComplete({
        deploymentId: deployment.id,
        status: DeploymentStatus.ROLLED_BACK as DeploymentStatusType,
        endpoint: appContext.appUrl,
      });
      return;
    }

    await this.attachRunLogs(
      doToken,
      deployment.environment.doAccountId,
      appContext.appId,
      deployCycleResult.doDeploymentId,
      deployment.id,
    );
    const errorMessage =
      deployCycleResult.outcome === 'TIMEOUT'
        ? 'App Platform rollback timed out'
        : 'App Platform rollback failed';
    await this.failDeployment(deployment.id, errorMessage);
  }

  private async getDeploymentOrThrow(deploymentId: string): Promise<DeploymentExecutionContext> {
    const deployment = await this.prismaService.deployment.findFirst({
      where: {
        id: deploymentId,
      },
      include: {
        environment: {
          select: {
            id: true,
            projectId: true,
            doAccountId: true,
            doAccount: {
              select: {
                doToken: true,
              },
            },
            pulumiStack: {
              select: {
                outputs: true,
              },
            },
          },
        },
      },
    });

    if (!deployment) {
      throw Exceptions.notFound('Deployment not found', ErrorCodes.DEPLOYMENT_NOT_FOUND);
    }

    return deployment;
  }

  private async resolveRollbackTarget(
    environmentId: string,
    targetDeploymentId?: string,
  ): Promise<{
    id: string;
    imageUri: string | null;
  } | null> {
    if (targetDeploymentId) {
      return this.prismaService.deployment.findFirst({
        where: {
          id: targetDeploymentId,
          environmentId,
          imageUri: {
            not: null,
          },
        },
        select: {
          id: true,
          imageUri: true,
        },
      });
    }

    return this.prismaService.deployment.findFirst({
      where: {
        environmentId,
        status: {
          in: [DeploymentStatus.SUCCESS, DeploymentStatus.ROLLED_BACK],
        },
        imageUri: {
          not: null,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        imageUri: true,
      },
    });
  }

  private async markBuildPushProgress(deployment: DeploymentExecutionContext): Promise<void> {
    const startedAt = deployment.startedAt ?? new Date();

    if (
      deployment.status === DeploymentStatus.PENDING ||
      deployment.status === DeploymentStatus.QUEUED
    ) {
      await this.prismaService.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.BUILDING,
          startedAt,
          errorMessage: null,
        },
      });
      this.broadcastDeploymentStatus(deployment.id, DeploymentStatus.BUILDING);
      await this.persistLog(deployment.id, LogLevel.INFO, 'Build started', 'workflow');
    }

    await this.prismaService.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.PUSHING,
        startedAt,
        errorMessage: null,
      },
    });
    this.broadcastDeploymentStatus(deployment.id, DeploymentStatus.PUSHING);
    await this.persistLog(
      deployment.id,
      LogLevel.INFO,
      'Waiting for image push callback from GitHub Actions',
      'workflow',
    );
  }

  /**
   * Patches one or more image URIs into the live App Platform spec atomically.
   * Each URI is routed to the App component whose `image.repository` matches
   * (see `buildUpdatedAppSpec`), so multi-service bundles update every
   * service's tag in a single updateApp + createDeployment cycle.
   */
  private async deployImagesToApp(
    doToken: string,
    doAccountId: string,
    appContext: AppDeploymentContext,
    imageUris: string[],
  ): Promise<AppDeployCycleResult> {
    if (imageUris.length === 0) {
      throw Exceptions.badRequest(
        'No image URIs to deploy',
        ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND,
      );
    }

    const app = await this.doApiService.getApp(doToken, appContext.appId, doAccountId);
    let nextSpec: Record<string, unknown> = app.spec as Record<string, unknown>;
    for (const imageUri of imageUris) {
      nextSpec = this.buildUpdatedAppSpec({ ...app, spec: nextSpec }, imageUri);
    }

    await this.doApiService.updateApp(doToken, appContext.appId, nextSpec, doAccountId);
    const doDeploymentId = await this.doApiService.createDeployment(doToken, appContext.appId, doAccountId);
    const outcome = await this.doApiService.waitForDeployment(
      doToken,
      appContext.appId,
      doDeploymentId,
      QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      doAccountId,
    );

    return { doDeploymentId, outcome };
  }

  /**
   * Builds a copy of the App Platform spec with the deployed service's image
   * bumped to the new tag. **Only the entry whose existing `image.repository`
   * matches the new image's repository is updated** — every other service (and
   * any workers/jobs) keeps its current image untouched. This is how multi-service
   * envs get atomic deploys without us accidentally redeploying the wrong service.
   *
   * Back-compat: single-service envs created before P1.7 (matrix builds) have
   * one entry with repository `<project>/<env>` and incoming image
   * `<docr>/<project>/<env>:<sha>` — the repositories match, so the patch lands.
   */
  private buildUpdatedAppSpec(app: DOApp, imageUri: string): Record<string, unknown> {
    if (!this.isRecord(app.spec)) {
      throw Exceptions.internalError('App Platform spec is missing', ErrorCodes.INTERNAL_ERROR);
    }

    const parsedImageUri = this.parseImageUri(imageUri);
    const nextSpec = JSON.parse(JSON.stringify(app.spec)) as Record<string, unknown>;
    const updatedCount =
      this.patchMatchingImageEntry(nextSpec, 'services', parsedImageUri) +
      this.patchMatchingImageEntry(nextSpec, 'workers', parsedImageUri) +
      this.patchMatchingImageEntry(nextSpec, 'jobs', parsedImageUri);

    if (updatedCount === 0) {
      throw Exceptions.internalError(
        `App Platform spec has no component matching image repository "${parsedImageUri.repository}". ` +
          'The Pulumi stack may be out of date — a re-provision is required to add the new service.',
        ErrorCodes.INTERNAL_ERROR,
      );
    }

    return nextSpec;
  }

  private patchMatchingImageEntry(
    appSpec: Record<string, unknown>,
    key: 'services' | 'workers' | 'jobs',
    parsedImageUri: ParsedImageUri,
  ): number {
    const collection = appSpec[key];
    if (!Array.isArray(collection)) {
      return 0;
    }

    let updates = 0;
    for (const item of collection) {
      if (!this.isRecord(item) || !this.isRecord(item.image)) {
        continue;
      }

      const currentRepository = typeof item.image.repository === 'string'
        ? item.image.repository
        : '';
      if (currentRepository !== parsedImageUri.repository) {
        continue;
      }

      item.image = {
        ...item.image,
        registry: parsedImageUri.registry,
        repository: parsedImageUri.repository,
        tag: parsedImageUri.tag,
      };
      updates += 1;
    }

    return updates;
  }

  private parseImageUri(imageUri: string): ParsedImageUri {
    const match = /^registry\.digitalocean\.com\/([^/]+)\/(.+):([^:]+)$/.exec(imageUri);
    if (!match) {
      throw Exceptions.badRequest('Invalid deployment image URI', ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND);
    }

    const registry = match[1];
    const repository = match[2];
    const tag = match[3];
    if (!registry || !repository || !tag) {
      throw Exceptions.badRequest('Invalid deployment image URI', ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND);
    }

    return {
      registry,
      repository,
      tag,
    };
  }

  private resolveAppContext(outputs: Prisma.JsonValue | null): AppDeploymentContext | null {
    if (!this.isRecord(outputs)) {
      return null;
    }

    const appId = this.resolveOutputValue(outputs.appId);
    const appUrl = this.resolveOutputValue(outputs.appUrl);
    if (!appId || !appUrl) {
      return null;
    }

    return {
      appId,
      appUrl,
    };
  }

  private resolveOutputValue(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (this.isRecord(value) && 'value' in value) {
      const nestedValue = value.value;
      if (typeof nestedValue === 'string') {
        return nestedValue;
      }
      if (typeof nestedValue === 'number' || typeof nestedValue === 'boolean') {
        return String(nestedValue);
      }
    }

    return null;
  }

  private decryptDoToken(encryptedToken: string): string {
    try {
      return this.encryptionService.decrypt(encryptedToken);
    } catch {
      throw Exceptions.internalError(
        'Stored DigitalOcean token cannot be decrypted',
        ErrorCodes.DO_ACCOUNT_VALIDATION_FAILED,
      );
    }
  }

  private async queueAutoRollback(failedDeploymentId: string, environmentId: string): Promise<void> {
    const rollbackTarget = await this.prismaService.deployment.findFirst({
      where: {
        environmentId,
        id: {
          not: failedDeploymentId,
        },
        status: {
          in: [DeploymentStatus.SUCCESS, DeploymentStatus.ROLLED_BACK],
        },
        imageUri: {
          not: null,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        imageUri: true,
        commitSha: true,
        branch: true,
      },
    });

    if (!rollbackTarget?.imageUri) {
      return;
    }

    const rollbackDeployment = await this.prismaService.deployment.create({
      data: {
        environmentId,
        status: DeploymentStatus.PENDING,
        imageUri: rollbackTarget.imageUri,
        commitSha: rollbackTarget.commitSha ?? null,
        branch: rollbackTarget.branch ?? null,
        commitMessage: rollbackTarget.commitSha
          ? `Auto rollback to ${rollbackTarget.commitSha.slice(0, 7)}`
          : 'Auto rollback',
        triggeredBy: 'system:auto-rollback',
      },
    });

    await this.deploymentsQueue.add(
      JOB_NAMES.DEPLOYMENTS.ROLLBACK,
      {
        deploymentId: rollbackDeployment.id,
        targetDeploymentId: rollbackTarget.id,
      },
      {
        jobId: rollbackDeployment.id,
        attempts: 1,
        timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      } as Parameters<Queue<DeployJobPayload | RollbackJobPayload>['add']>[2] & { timeout: number },
    );

    await this.prismaService.deployment.update({
      where: {
        id: rollbackDeployment.id,
      },
      data: {
        status: DeploymentStatus.QUEUED,
      },
    });
    this.broadcastDeploymentStatus(rollbackDeployment.id, DeploymentStatus.QUEUED);

    await this.persistLog(
      failedDeploymentId,
      LogLevel.WARN,
      `Queued automatic rollback deployment ${rollbackDeployment.id} to ${rollbackTarget.id}`,
      'system',
    );
  }

  private async failDeployment(deploymentId: string, errorMessage: string): Promise<void> {
    await this.prismaService.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DeploymentStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
      },
    });
    this.broadcastDeploymentStatus(deploymentId, DeploymentStatus.FAILED);
    this.eventsGateway.broadcastDeploymentComplete({
      deploymentId,
      status: DeploymentStatus.FAILED as DeploymentStatusType,
    });
  }

  private async attachRunLogs(
    doToken: string,
    doAccountId: string,
    appId: string,
    doDeploymentId: string,
    deploymentId: string,
  ): Promise<void> {
    try {
      const rawLogs = await this.doApiService.getDeploymentLogs(
        doToken,
        appId,
        doDeploymentId,
        doAccountId,
      );
      const logLines = rawLogs
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(-200);

      for (const logLine of logLines) {
        await this.persistLog(deploymentId, LogLevel.ERROR, logLine, 'do-app-platform');
      }
    } catch {
      await this.persistLog(
        deploymentId,
        LogLevel.WARN,
        'Failed to retrieve App Platform deployment logs',
        'do-app-platform',
      );
    }
  }

  private async persistLog(
    deploymentId: string,
    level: LogLevel,
    message: string,
    source: string,
  ): Promise<void> {
    const timestamp = new Date();
    await this.prismaService.deploymentLog.create({
      data: {
        deploymentId,
        level,
        message,
        source,
        timestamp,
      },
    });

    this.eventsGateway.broadcastDeploymentLog({
      deploymentId,
      line: message,
      timestamp: timestamp.toISOString(),
      level: this.toSocketLogLevel(level),
      source,
    });
  }

  private broadcastDeploymentStatus(deploymentId: string, status: DeploymentStatus): void {
    this.eventsGateway.broadcastDeploymentStatus({
      deploymentId,
      status: status as DeploymentStatusType,
      timestamp: new Date().toISOString(),
    });
  }

  private toSocketLogLevel(level: LogLevel): 'debug' | 'info' | 'warn' | 'error' {
    if (level === LogLevel.DEBUG) {
      return 'debug';
    }
    if (level === LogLevel.WARN) {
      return 'warn';
    }
    if (level === LogLevel.ERROR) {
      return 'error';
    }
    return 'info';
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Deployment processor failed';
  }

  private sanitizeErrorMessage(message: string): string {
    return message
      .replace(/dop_v1_[a-zA-Z0-9]+/g, '[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
