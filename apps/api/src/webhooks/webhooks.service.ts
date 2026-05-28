import { InjectQueue } from '@nestjs/bullmq';
import {
  DeploymentBundleStatus,
  DeploymentStatus,
  Prisma,
  type Deployment,
  type DeploymentBundle,
  type Service,
} from '@prisma/client';
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
 *
 * `serviceName` is optional for back-compat with workflows committed before
 * the matrix build (P1.7). When absent, the env's first Service is assumed.
 */
export interface DeployCompletePayload {
  environmentId: string;
  serviceName?: string;
  imageUri: string;
  commitSha: string;
  status?: string;
  runUrl?: string;
  buildStrategy?: 'dockerfile' | 'nixpacks' | string;
  buildPlan?: string;
}

/**
 * Handles inbound webhook processing for GitHub and Liftoff workflow callbacks.
 *
 * Push lifecycle (post-Phase-1 multi-service):
 *   1. push → create a DeploymentBundle + one Deployment per Service in the env
 *   2. matrix workflow builds images in parallel; each calls deploy-complete
 *      with `serviceName` so we route to the right Deployment row
 *   3. once every Deployment in the bundle has an image (or any failed), the
 *      bundle is "complete" and we enqueue ONE atomic apply job:
 *        - PROVISION (no Pulumi stack yet) — passes bundleId to the infra
 *          processor which builds a serviceImages map from the bundle
 *        - DEPLOY (stack exists)            — same, single updateApp patch
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
      where: { fullName: payload.repository.full_name },
      select: { id: true, projectId: true, webhookSecret: true },
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
      where: { projectId: repository.projectId, gitBranch: branch, deletedAt: null },
      select: {
        id: true,
        services: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!environment) {
      this.logger.log(
        `Ignoring push for ${payload.repository.full_name} on ${branch}: no matching environment`,
      );
      return;
    }

    if (environment.services.length === 0) {
      this.logger.warn(
        `Ignoring push for environment ${environment.id}: no Service rows yet — UI must create at least one`,
      );
      return;
    }

    const activeDeployment = await this.prismaService.deployment.findFirst({
      where: {
        environmentId: environment.id,
        status: { in: ACTIVE_STATUSES as DeploymentStatus[] },
      },
      select: { id: true },
    });
    if (activeDeployment) {
      this.logger.log(
        `Ignoring push for environment ${environment.id}: deployment ${activeDeployment.id} still active`,
      );
      return;
    }

    // Create the bundle + one Deployment per Service. The bundle starts
    // IN_PROGRESS; deploy-complete callbacks fill in per-service images and
    // the last arrival finalises it.
    const commitSha = payload.head_commit?.id ?? null;
    const commitMessage = payload.head_commit?.message ?? null;
    const bundle = await this.prismaService.deploymentBundle.create({
      data: {
        environmentId: environment.id,
        status: DeploymentBundleStatus.IN_PROGRESS,
        commitSha,
        triggeredBy: 'webhook',
        startedAt: new Date(),
        deployments: {
          create: environment.services.map((service) => ({
            environmentId: environment.id,
            serviceId: service.id,
            status: DeploymentStatus.PENDING,
            commitSha,
            commitMessage,
            branch,
            triggeredBy: 'webhook',
          })),
        },
      },
      include: { deployments: true },
    });

    // Each Deployment gets its own DEPLOY job so the processor can advance
    // its status independently (BUILDING/PUSHING are per-service UX states
    // while GitHub Actions matrix jobs build in parallel).
    for (const deployment of bundle.deployments) {
      await this.deploymentsQueue.add(
        JOB_NAMES.DEPLOYMENTS.DEPLOY,
        {
          deploymentId: deployment.id,
          environmentId: environment.id,
          commitSha: commitSha ?? undefined,
          bundleId: bundle.id,
        },
        {
          jobId: deployment.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
        } as Parameters<Queue<DeployJobPayload>['add']>[2] & { timeout: number },
      );
    }

    await this.prismaService.deployment.updateMany({
      where: { bundleId: bundle.id, status: DeploymentStatus.PENDING },
      data: { status: DeploymentStatus.QUEUED },
    });
  }

  /**
   * Handles deploy completion callback from repository workflow.
   *
   * One callback per matrix job (= per Service per push). Updates the matching
   * Deployment row, then checks the parent bundle: if all sibling deployments
   * have reported, we enqueue ONE atomic apply (no per-service updateApp races).
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
      where: { id: payload.environmentId, deletedAt: null },
      select: {
        id: true,
        configYaml: true,
        configParsed: true,
        liftoffDeploySecret: true,
        pulumiStack: { select: { outputs: true } },
        services: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
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

    // Resolve the target Service. If serviceName is provided, look it up by name
    // (canonical post-P1.7 path). Otherwise fall back to the env's first service
    // for back-compat with workflows committed before the matrix build landed.
    const targetService = payload.serviceName
      ? environment.services.find((service) => service.name === payload.serviceName) ?? null
      : environment.services[0] ?? null;

    if (!targetService) {
      throw Exceptions.notFound(
        payload.serviceName
          ? `Service "${payload.serviceName}" not found in environment`
          : 'Environment has no services to attach the deployment to',
        ErrorCodes.NOT_FOUND,
      );
    }

    // Find the in-flight Deployment for this Service. Prefer the most recent
    // in QUEUED|BUILDING|PUSHING — that's the row created by handleGitHubPush
    // (or by deploymentsService.trigger for manual deploys).
    const deployment = await this.prismaService.deployment.findFirst({
      where: {
        environmentId: environment.id,
        serviceId: targetService.id,
        status: {
          in: [DeploymentStatus.QUEUED, DeploymentStatus.BUILDING, DeploymentStatus.PUSHING],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, bundleId: true },
    });
    if (!deployment) {
      throw Exceptions.notFound(
        `No deployment in QUEUED, BUILDING, or PUSHING state for service "${targetService.name}"`,
        ErrorCodes.DEPLOYMENT_NOT_FOUND,
      );
    }

    // Failure path: mark this service's deployment FAILED. If part of a bundle,
    // the bundle will be set to FAILED/PARTIAL once all siblings have reported.
    if (payload.status && payload.status.toLowerCase() === 'failure') {
      await this.prismaService.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.FAILED,
          errorMessage: `Build/push failed for service "${targetService.name}". GitHub Actions run: ${payload.runUrl || 'unknown'}`,
          buildRunUrl: payload.runUrl ?? null,
          buildStrategy: payload.buildStrategy?.toLowerCase() ?? null,
          buildPlan: this.parseBuildPlan(payload.buildPlan),
          completedAt: new Date(),
        },
      });
      this.logger.warn(
        `Deployment ${deployment.id} (service ${targetService.name}) failed during build/push`,
      );
      if (deployment.bundleId) {
        await this.finalizeBundleIfReady(deployment.bundleId);
      }
      return;
    }

    // Success path: record the image. Status moves to a "ready to apply" sentinel.
    // We DON'T enqueue per-service apply jobs — instead we wait for the bundle to
    // complete and dispatch one atomic apply over all services together.
    await this.prismaService.deployment.update({
      where: { id: deployment.id },
      data: {
        commitSha: payload.commitSha,
        imageUri: payload.imageUri,
        buildRunUrl: payload.runUrl ?? null,
        buildStrategy: payload.buildStrategy?.toLowerCase() ?? null,
        buildPlan: this.parseBuildPlan(payload.buildPlan),
        status: DeploymentStatus.PUSHING,
      },
    });

    if (deployment.bundleId) {
      await this.finalizeBundleIfReady(deployment.bundleId);
      return;
    }

    // Legacy single-deployment path (no bundle — manual trigger or pre-Phase-1 row).
    await this.dispatchApply(
      environment,
      [{ deploymentId: deployment.id, serviceName: targetService.name, imageUri: payload.imageUri }],
      null,
    );
  }

  /**
   * Checks whether all deployments in a bundle have reported (either SUCCESS-ready
   * or FAILED). If so, dispatches the atomic apply (PROVISION or DEPLOY) and
   * advances the bundle status accordingly.
   */
  private async finalizeBundleIfReady(bundleId: string): Promise<void> {
    const bundle = await this.prismaService.deploymentBundle.findUnique({
      where: { id: bundleId },
      include: {
        deployments: {
          include: { service: { select: { name: true } } },
        },
        environment: {
          select: {
            id: true,
            configYaml: true,
            configParsed: true,
            pulumiStack: { select: { outputs: true } },
          },
        },
      },
    });
    if (!bundle) {
      return;
    }

    const inFlightStatuses: DeploymentStatus[] = [
      DeploymentStatus.QUEUED,
      DeploymentStatus.BUILDING,
    ];
    const stillInFlight = bundle.deployments.filter((d) => inFlightStatuses.includes(d.status));
    if (stillInFlight.length > 0) {
      this.logger.debug(
        `Bundle ${bundleId}: ${stillInFlight.length}/${bundle.deployments.length} services still building`,
      );
      return;
    }

    const failedDeployments = bundle.deployments.filter(
      (d) => d.status === DeploymentStatus.FAILED,
    );
    if (failedDeployments.length > 0) {
      // Any failure halts the whole bundle apply — we don't want to deploy a
      // half-built env where one service has a stale image. Mark every still-
      // pushing deployment as cancelled.
      await this.prismaService.deployment.updateMany({
        where: {
          bundleId,
          status: { in: [DeploymentStatus.PUSHING, DeploymentStatus.QUEUED] },
        },
        data: {
          status: DeploymentStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: 'Sibling service in bundle failed',
        },
      });
      await this.prismaService.deploymentBundle.update({
        where: { id: bundleId },
        data: {
          status:
            failedDeployments.length === bundle.deployments.length
              ? DeploymentBundleStatus.FAILED
              : DeploymentBundleStatus.PARTIAL,
          completedAt: new Date(),
          errorMessage: `${failedDeployments.length}/${bundle.deployments.length} services failed to build`,
        },
      });
      return;
    }

    // All deployments have imageUri; dispatch atomic apply.
    const apply = bundle.deployments.map((d) => ({
      deploymentId: d.id,
      serviceName: d.service?.name ?? 'unknown',
      imageUri: d.imageUri ?? '',
    }));
    await this.dispatchApply(bundle.environment, apply, bundleId);
  }

  /**
   * Enqueues the appropriate apply job (PROVISION or DEPLOY) for a bundle's
   * worth of per-service images. PROVISION when no Pulumi stack exists yet;
   * DEPLOY when we just need to patch images on the existing App spec.
   */
  private async dispatchApply(
    environment: {
      id: string;
      configYaml: string | null;
      configParsed: Prisma.JsonValue | null;
      pulumiStack: { outputs: Prisma.JsonValue | null } | null;
    },
    services: Array<{ deploymentId: string; serviceName: string; imageUri: string }>,
    bundleId: string | null,
  ): Promise<void> {
    const appContext = this.resolveAppContext(environment.pulumiStack?.outputs);
    const anchorDeployment = services[0];
    if (!anchorDeployment) {
      return;
    }

    if (appContext) {
      // Stack exists → patch images on the live App Platform spec.
      await this.prismaService.deployment.updateMany({
        where: { id: { in: services.map((s) => s.deploymentId) } },
        data: { status: DeploymentStatus.DEPLOYING },
      });

      await this.deploymentsQueue.add(
        JOB_NAMES.DEPLOYMENTS.DEPLOY,
        {
          deploymentId: anchorDeployment.deploymentId,
          environmentId: environment.id,
          commitSha: undefined,
          bundleId: bundleId ?? undefined,
        },
        {
          jobId: anchorDeployment.deploymentId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
        } as Parameters<Queue<DeployJobPayload>['add']>[2] & { timeout: number },
      );
      return;
    }

    // No stack → run Pulumi up. The infra processor reads per-service images
    // from the bundle (when bundleId is set) and constructs the App from scratch.
    const resolvedConfigYaml = this.resolveConfigYaml(environment.configYaml, environment.configParsed);
    if (!resolvedConfigYaml) {
      await this.prismaService.deployment.updateMany({
        where: { id: { in: services.map((s) => s.deploymentId) } },
        data: {
          status: DeploymentStatus.FAILED,
          errorMessage: 'Environment configuration is missing',
          completedAt: new Date(),
        },
      });
      throw Exceptions.badRequest(
        'Environment configuration is missing',
        ErrorCodes.CONFIG_MISSING_REQUIRED_FIELDS,
      );
    }

    await this.prismaService.deployment.updateMany({
      where: { id: { in: services.map((s) => s.deploymentId) } },
      data: { status: DeploymentStatus.PROVISIONING },
    });

    await this.infrastructureQueue.add(
      JOB_NAMES.INFRASTRUCTURE.PROVISION,
      {
        deploymentId: anchorDeployment.deploymentId,
        environmentId: environment.id,
        imageUri: anchorDeployment.imageUri, // legacy single-image field; ignored by processor when bundleId present
        configYaml: resolvedConfigYaml,
        bundleId: bundleId ?? undefined,
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

    return { appId, appUrl };
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

  private secretsMatch(providedSecret: string, expectedSecret: string): boolean {
    const providedBuffer = Buffer.from(providedSecret, 'utf8');
    const expectedBuffer = Buffer.from(expectedSecret, 'utf8');
    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
