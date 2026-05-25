import { InjectQueue } from '@nestjs/bullmq';
import { DeploymentStatus, Prisma } from '@prisma/client';
import { ACTIVE_STATUSES, ErrorCodes, safeParseLiftoffConfig } from '@liftoff/shared';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { timingSafeEqual } from 'crypto';
import * as yaml from 'js-yaml';
import { AppException, Exceptions } from '../common/exceptions/app.exception';
import { EncryptionService } from '../common/services/encryption.service';
import {
  JOB_NAMES,
  QUEUE_TIMEOUTS,
  QUEUE_NAMES,
  DeployJobPayload,
  InfraProvisionJobPayload,
} from '../queues/queue.constants';
import { GitHubService } from '../repositories/github.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * GitHub push webhook payload subset used by Liftoff.
 */
export interface GitHubPushPayload {
  ref: string;
  repository: {
    full_name: string;
  };
  head_commit?: {
    id?: string;
    message?: string;
  };
}

/**
 * Deploy-complete webhook payload.
 */
export interface DeployCompletePayload {
  environmentId: string;
  imageUri: string;
  commitSha: string;
  status?: string;
  runUrl?: string;
  buildStrategy?: 'dockerfile' | 'nixpacks' | string;
  buildPlan?: string;
}

/**
 * Handles inbound webhook processing for GitHub and Liftoff workflow callbacks.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly githubService: GitHubService,
    @InjectQueue(QUEUE_NAMES.DEPLOYMENTS)
    private readonly deploymentsQueue: Queue<DeployJobPayload>,
    @InjectQueue(QUEUE_NAMES.INFRASTRUCTURE)
    private readonly infrastructureQueue: Queue<InfraProvisionJobPayload>,
  ) {}

  /**
   * Validates and handles GitHub push webhooks.
   */
  public async handleGitHubPush(
    payload: GitHubPushPayload,
    signature: string | undefined,
    rawBody: Buffer,
  ): Promise<void> {
    if (
      !payload.repository?.full_name ||
      typeof payload.ref !== 'string' ||
      !payload.ref.startsWith('refs/heads/')
    ) {
      return;
    }

    const repository = await this.prismaService.repository.findFirst({
      where: {
        fullName: payload.repository.full_name,
      },
      select: {
        id: true,
        projectId: true,
        webhookSecret: true,
      },
    });
    if (!repository || !repository.webhookSecret) {
      this.logger.log(`Ignoring webhook for unconnected repository ${payload.repository.full_name}`);
      return;
    }

    const webhookSecret = this.decryptSecret(repository.webhookSecret, 'repository webhook secret');
    const isValidSignature = this.githubService.verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValidSignature) {
      throw new AppException(
        'Invalid webhook signature',
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_UNAUTHORIZED,
      );
    }

    this.logger.log(`Webhook received from ${payload.repository.full_name}`);

    const branch = payload.ref.replace('refs/heads/', '');
    const environment = await this.prismaService.environment.findFirst({
      where: {
        projectId: repository.projectId,
        gitBranch: branch,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    if (!environment) {
      this.logger.log(
        `Ignoring push for ${payload.repository.full_name} on ${branch}: no matching environment`,
      );
      return;
    }

    const activeDeployment = await this.prismaService.deployment.findFirst({
      where: {
        environmentId: environment.id,
        status: {
          in: ACTIVE_STATUSES as DeploymentStatus[],
        },
      },
      select: {
        id: true,
      },
    });
    if (activeDeployment) {
      this.logger.log(
        `Ignoring push for environment ${environment.id}: deployment ${activeDeployment.id} still active`,
      );
      return;
    }

    const deployment = await this.prismaService.deployment.create({
      data: {
        environmentId: environment.id,
        status: DeploymentStatus.PENDING,
        commitSha: payload.head_commit?.id ?? null,
        commitMessage: payload.head_commit?.message ?? null,
        branch,
        triggeredBy: 'webhook',
      },
      select: {
        id: true,
        commitSha: true,
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
      } as Parameters<Queue<DeployJobPayload>['add']>[2] & { timeout: number },
    );

    await this.prismaService.deployment.update({
      where: {
        id: deployment.id,
      },
      data: {
        status: DeploymentStatus.QUEUED,
      },
    });
  }

  /**
   * Handles deploy completion callback from repository workflow.
   */
  public async handleDeployComplete(
    payload: DeployCompletePayload,
    secretHeader: string | undefined,
  ): Promise<void> {
    if (!secretHeader) {
      throw new AppException(
        'Missing deploy webhook secret',
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_UNAUTHORIZED,
      );
    }

    const environment = await this.prismaService.environment.findFirst({
      where: {
        id: payload.environmentId,
        deletedAt: null,
      },
      select: {
        id: true,
        configYaml: true,
        configParsed: true,
        liftoffDeploySecret: true,
        pulumiStack: {
          select: {
            outputs: true,
          },
        },
      },
    });
    if (!environment) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }

    if (!environment.liftoffDeploySecret) {
      throw new AppException(
        'Deploy secret is not configured for this environment',
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_UNAUTHORIZED,
      );
    }

    const deploySecret = this.decryptSecret(environment.liftoffDeploySecret, 'environment deploy secret');
    if (!this.secretsMatch(secretHeader, deploySecret)) {
      throw new AppException(
        'Invalid deploy webhook secret',
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_UNAUTHORIZED,
      );
    }

    const deployment = await this.prismaService.deployment.findFirst({
      where: {
        environmentId: environment.id,
        status: {
          in: [DeploymentStatus.QUEUED, DeploymentStatus.BUILDING, DeploymentStatus.PUSHING],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
      },
    });
    if (!deployment) {
      throw Exceptions.notFound(
        'No deployment in QUEUED, BUILDING, or PUSHING state for this environment',
        ErrorCodes.DEPLOYMENT_NOT_FOUND,
      );
    }

    // If the GitHub Actions job failed, mark deployment as FAILED
    if (payload.status && payload.status.toLowerCase() === 'failure') {
      await this.prismaService.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.FAILED,
          errorMessage: `Deployment failed during build/push phase. GitHub Actions run: ${payload.runUrl || 'unknown'}`,
          buildRunUrl: payload.runUrl ?? null,
          buildStrategy: payload.buildStrategy?.toLowerCase() ?? null,
          buildPlan: this.parseBuildPlan(payload.buildPlan),
          completedAt: new Date(),
        },
      });
      this.logger.warn(`Deployment ${deployment.id} failed with GitHub Actions status: failure`);
      return;
    }

    const appContext = this.resolveAppContext(environment.pulumiStack?.outputs);
    if (appContext) {
      await this.prismaService.deployment.update({
        where: {
          id: deployment.id,
        },
        data: {
          commitSha: payload.commitSha,
          imageUri: payload.imageUri,
          buildRunUrl: payload.runUrl ?? null,
          buildStrategy: payload.buildStrategy?.toLowerCase() ?? null,
          buildPlan: this.parseBuildPlan(payload.buildPlan),
          status: DeploymentStatus.DEPLOYING,
        },
      });

      await this.deploymentsQueue.add(
        JOB_NAMES.DEPLOYMENTS.DEPLOY,
        {
          deploymentId: deployment.id,
          environmentId: environment.id,
          commitSha: payload.commitSha,
        },
        {
          jobId: deployment.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
        } as Parameters<Queue<DeployJobPayload>['add']>[2] & { timeout: number },
      );
      return;
    }

    const resolvedConfigYaml = this.resolveConfigYaml(environment.configYaml, environment.configParsed);
    if (!resolvedConfigYaml) {
      await this.markDeploymentFailedForMissingConfig(deployment.id);
      throw Exceptions.badRequest(
        'Environment configuration is missing',
        ErrorCodes.CONFIG_MISSING_REQUIRED_FIELDS,
      );
    }

    await this.prismaService.deployment.update({
      where: {
        id: deployment.id,
      },
      data: {
        commitSha: payload.commitSha,
        imageUri: payload.imageUri,
        buildRunUrl: payload.runUrl ?? null,
        buildStrategy: payload.buildStrategy?.toLowerCase() ?? null,
        buildPlan: this.parseBuildPlan(payload.buildPlan),
        status: DeploymentStatus.PROVISIONING,
      },
    });

    await this.infrastructureQueue.add(
      JOB_NAMES.INFRASTRUCTURE.PROVISION,
      {
        deploymentId: deployment.id,
        environmentId: environment.id,
        imageUri: payload.imageUri,
        configYaml: resolvedConfigYaml,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      } as Parameters<Queue<InfraProvisionJobPayload>['add']>[2] & { timeout: number },
    );
  }

  private decryptSecret(encryptedSecret: string, secretLabel: string): string {
    try {
      return this.encryptionService.decrypt(encryptedSecret);
    } catch {
      throw Exceptions.internalError(
        `Stored ${secretLabel} cannot be decrypted`,
        ErrorCodes.INTERNAL_ERROR,
      );
    }
  }

  private resolveConfigYaml(configYaml: string | null, configParsed: unknown): string | null {
    if (configYaml) {
      return configYaml;
    }

    if (configParsed === null) {
      return null;
    }

    const parsedConfig = safeParseLiftoffConfig(configParsed);
    if (!parsedConfig.success) {
      return null;
    }

    return yaml.dump(parsedConfig.data);
  }

  private resolveAppContext(outputs: unknown): { appId: string; appUrl: string } | null {
    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
      return null;
    }

    const outputRecord = outputs as Record<string, unknown>;
    const appId = this.resolveOutputValue(outputRecord.appId);
    const appUrl = this.resolveOutputValue(outputRecord.appUrl);
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

    if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
      const nestedValue = (value as { value?: unknown }).value;
      if (typeof nestedValue === 'string') {
        return nestedValue;
      }

      if (typeof nestedValue === 'number' || typeof nestedValue === 'boolean') {
        return String(nestedValue);
      }
    }

    return null;
  }

  private parseBuildPlan(buildPlan: string | undefined): Prisma.InputJsonValue | undefined {
    if (!buildPlan) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(buildPlan) as Prisma.InputJsonValue;
      return parsed;
    } catch {
      return buildPlan;
    }
  }

  private async markDeploymentFailedForMissingConfig(deploymentId: string): Promise<void> {
    await this.prismaService.deployment.update({
      where: {
        id: deploymentId,
      },
      data: {
        status: DeploymentStatus.FAILED,
        errorMessage: 'Environment configuration is missing',
        completedAt: new Date(),
      },
    });
  }

  private secretsMatch(providedSecret: string, expectedSecret: string): boolean {
    const providedBuffer = Buffer.from(providedSecret, 'utf8');
    const expectedBuffer = Buffer.from(expectedSecret, 'utf8');
    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
