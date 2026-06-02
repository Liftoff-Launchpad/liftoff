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
 *
 * `imageUri` is optional because the workflow's `Notify Liftoff` step fires
 * `if: always()` — failed matrix steps don't produce an image but still POST
 * here so we can mark the deployment FAILED with the GitHub Actions run URL.
 * The handler requires it only on the success path.
 */
export interface DeployCompletePayload {
  environmentId: string;
  serviceName?: string;
  imageUri?: string;
  commitSha: string;
  status?: string;
  runUrl?: string;
  buildStrategy?: 'dockerfile' | 'nixpacks' | string;
  buildPlan?: string;
  /**
   * Base64-encoded tail of the workflow's stdout+stderr. Sent on every callback
   * so failures show the actual build error in the UI; on success we still
   * persist it so users can audit warnings/timings. Decoded + chunked into
   * DeploymentLog rows on the failure path.
   */
  buildLogsBase64?: string;
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

    // The same GitHub repo may be linked to multiple Liftoff projects (each with
    // its own webhook on GitHub and its own encrypted secret in our DB). On every
    // push, GitHub fires every webhook, but only one signature matches the
    // currently-firing secret. Try every candidate row, use whichever decrypts
    // to a matching HMAC. Without this, `findFirst` would return one arbitrary
    // row and 401 every other project's webhook.
    const repositoryCandidates = await this.prismaService.repository.findMany({
      where: {
        fullName: payload.repository.full_name,
        webhookSecret: { not: null },
      },
      select: { id: true, projectId: true, webhookSecret: true },
    });
    if (repositoryCandidates.length === 0) {
      this.logger.log(`Ignoring webhook for unconnected repository ${payload.repository.full_name}`);
      return;
    }

    let matchedRepository: { id: string; projectId: string } | null = null;
    for (const candidate of repositoryCandidates) {
      if (!candidate.webhookSecret) continue;
      const secret = this.decryptSecret(candidate.webhookSecret, 'repository webhook secret');
      if (this.githubService.verifyWebhookSignature(rawBody, signature, secret)) {
        matchedRepository = { id: candidate.id, projectId: candidate.projectId };
        break;
      }
    }
    if (!matchedRepository) {
      throw new AppException(
        'Invalid webhook signature',
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_UNAUTHORIZED,
      );
    }

    this.logger.log(
      `Webhook received from ${payload.repository.full_name} (matched project ${matchedRepository.projectId})`,
    );

    const branch = payload.ref.replace('refs/heads/', '');
    const environment = await this.prismaService.environment.findFirst({
      where: { projectId: matchedRepository.projectId, gitBranch: branch, deletedAt: null },
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

    const statusLower = payload.status?.toLowerCase();
    const isFailure = statusLower === 'failure' || statusLower === 'cancelled';

    // Failure path: mark this service's deployment FAILED. If part of a bundle,
    // the bundle will be set to FAILED/PARTIAL once all siblings have reported.
    // imageUri is often empty here — the matrix step failed before producing
    // an image. We still record runUrl / strategy so the UI can deep-link to
    // the failed GitHub Actions run.
    if (isFailure) {
      const decodedLogs = this.decodeBuildLogs(payload.buildLogsBase64);
      const errorTail = decodedLogs ? this.extractErrorTail(decodedLogs) : null;

      await this.prismaService.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.FAILED,
          errorMessage: this.buildFailureErrorMessage(
            statusLower ?? 'failure',
            targetService.name,
            payload.runUrl,
            errorTail,
          ),
          buildRunUrl: payload.runUrl ?? null,
          buildStrategy: payload.buildStrategy?.toLowerCase() ?? null,
          buildPlan: this.parseBuildPlan(payload.buildPlan),
          completedAt: new Date(),
        },
      });

      if (decodedLogs) {
        await this.persistBuildLogs(deployment.id, decodedLogs);
      }

      this.logger.warn(
        `Deployment ${deployment.id} (service ${targetService.name}) ${statusLower} during build/push` +
          (errorTail ? ` — ${errorTail.slice(0, 200).replace(/\s+/g, ' ')}` : ''),
      );
      if (deployment.bundleId) {
        await this.finalizeBundleIfReady(deployment.bundleId);
      }
      return;
    }

    // Success path: we MUST have an image URI to deploy. The DTO allows it to
    // be missing on failure callbacks, so guard here for the success branch.
    if (!payload.imageUri) {
      throw Exceptions.badRequest(
        'imageUri is required when status is success or omitted',
        ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND,
      );
    }
    const imageUri = payload.imageUri;

    // Record the image. Status moves to a "ready to apply" sentinel. We DON'T
    // enqueue per-service apply jobs — instead we wait for the bundle to complete
    // and dispatch one atomic apply over all services together.
    await this.prismaService.deployment.update({
      where: { id: deployment.id },
      data: {
        commitSha: payload.commitSha,
        imageUri,
        buildRunUrl: payload.runUrl ?? null,
        buildStrategy: payload.buildStrategy?.toLowerCase() ?? null,
        buildPlan: this.parseBuildPlan(payload.buildPlan),
        status: DeploymentStatus.PUSHING,
      },
    });

    const successLogs = this.decodeBuildLogs(payload.buildLogsBase64);
    if (successLogs) {
      await this.persistBuildLogs(deployment.id, successLogs);
    }

    if (deployment.bundleId) {
      await this.finalizeBundleIfReady(deployment.bundleId);
      return;
    }

    // Legacy single-deployment path (no bundle — manual trigger or pre-Phase-1 row).
    await this.dispatchApply(
      environment,
      [{ deploymentId: deployment.id, serviceName: targetService.name, imageUri }],
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

  /**
   * Decodes the base64 build-log payload from the GitHub Actions Notify step.
   * Returns null when missing or malformed (we never want a bad payload to
   * 500 the webhook — the deploy state update matters more than the logs).
   */
  private decodeBuildLogs(base64?: string): string | null {
    if (!base64) return null;
    try {
      const decoded = Buffer.from(base64, 'base64').toString('utf8');
      return decoded.length > 0 ? decoded : null;
    } catch (error) {
      this.logger.warn(`Failed to decode buildLogsBase64: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Strips GitHub Actions workflow-command markers from a single log line,
   * returning the human-readable remainder — or `null` for a pure structural
   * marker that carries no message (e.g. `::endgroup::`) so callers drop it.
   *
   * Handles both marker dialects the workflow can emit:
   *   - legacy:  `##[group]Title`, `##[endgroup]`, `##[error]msg`
   *   - current: `::group::Title`, `::endgroup::`, `::error file=a,line=1::msg`
   * Group/section titles are preserved (they're useful headers); bare markers
   * with no value are dropped.
   */
  private cleanWorkflowLogLine(raw: string): string | null {
    // Legacy `##[command]` prefix — strip it, keep any trailing text.
    let line = raw.replace(/^##\[[^\]]+\]\s*/, '');

    // Current `::command[ params]::value` form.
    const tokenMatch = /^::[a-z-]+(?:\s+[^:]*)?::(.*)$/i.exec(line);
    if (tokenMatch) {
      const value = (tokenMatch[1] ?? '').trim();
      if (value.length === 0) {
        return null; // e.g. `::endgroup::`
      }
      line = value; // e.g. `::group::nixpacks build` -> `nixpacks build`
    }

    return line;
  }

  /**
   * Extracts the last meaningful chunk of build output for the deployment's
   * one-line errorMessage summary. Looks for the last "ERROR" / "FAILED" /
   * "error:" / Docker error marker; falls back to the last non-empty line.
   */
  private extractErrorTail(logs: string): string | null {
    const lines = logs
      .split(/\r?\n/)
      .map((line) => this.cleanWorkflowLogLine(line)?.trim() ?? '')
      .filter((line) => line.length > 0);
    if (lines.length === 0) return null;

    const errorPattern = /(error|failed|fatal|aborted|cannot|missing|not found|denied)/i;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
      const candidate = lines[i];
      if (candidate && errorPattern.test(candidate)) {
        return candidate.slice(0, 500);
      }
    }
    const last = lines[lines.length - 1];
    return last ? last.slice(0, 500) : null;
  }

  /**
   * Compose a one-line `Deployment.errorMessage`. Used by the failed-state UI
   * (and the "FAILED" toast) so users see a real diagnostic without opening
   * the logs tab. Falls back to the legacy generic message when no logs.
   */
  private buildFailureErrorMessage(
    status: string,
    serviceName: string,
    runUrl: string | undefined,
    errorTail: string | null,
  ): string {
    const base = `Build/push ${status} for service "${serviceName}".`;
    const tail = errorTail ? ` Last error: ${errorTail}` : '';
    const link = runUrl ? ` GitHub Actions run: ${runUrl}` : '';
    return `${base}${tail}${link}`;
  }

  /**
   * Splits the captured workflow output into per-line DeploymentLog rows with
   * source="build". Chunks to avoid one giant row blowing past Postgres TEXT
   * read perf or the UI's render budget. Errors persisting are logged but not
   * thrown — losing logs shouldn't fail the webhook.
   */
  private async persistBuildLogs(deploymentId: string, logs: string): Promise<void> {
    // Clean each line through the shared marker stripper, dropping pure
    // structural markers (e.g. `::endgroup::`) and blanks. This is what keeps
    // the viewer free of `::group::`/`##[...]` noise.
    const cleaned = logs
      .split(/\r?\n/)
      .map((line) => this.cleanWorkflowLogLine(line))
      .filter((line): line is string => line !== null && line.length > 0);
    if (cleaned.length === 0) return;

    const baseTime = Date.now();
    const rows = cleaned.map((message, index) => {
      const isError = /\b(error|failed|fatal|denied|aborted)\b/i.test(message);
      return {
        deploymentId,
        message,
        level: isError ? ('ERROR' as const) : ('INFO' as const),
        source: 'build',
        // Stable monotonic timestamps so the logs render in workflow order.
        timestamp: new Date(baseTime + index),
      };
    });

    try {
      await this.prismaService.deploymentLog.createMany({ data: rows });
    } catch (error) {
      this.logger.warn(
        `Failed to persist ${rows.length} build log rows for deployment ${deploymentId}: ${(error as Error).message}`,
      );
    }
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
