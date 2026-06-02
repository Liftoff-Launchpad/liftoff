import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  DeploymentStatus,
  LogLevel,
  Prisma,
  type Deployment,
} from '@prisma/client';
import {
  DeploymentStatusType,
  ErrorCodes,
  type LiftoffConfigV2,
  safeParseLiftoffConfigAny,
} from '@liftoff/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import * as yaml from 'js-yaml';
import { Exceptions } from '../common/exceptions/app.exception';
import { EncryptionService } from '../common/services/encryption.service';
import { DoApiService } from '../do-api/do-api.service';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  InfraDestroyJobPayload,
  InfraProvisionJobPayload,
  JOB_NAMES,
  QUEUE_TIMEOUTS,
  QUEUE_NAMES,
} from '../queues/queue.constants';
import { VariablesService } from '../variables/variables.service';
import { PulumiRunnerService } from './pulumi-runner.service';
import {
  AppPlatformStackArgs,
  AppPlatformVariable,
  PulumiLogLevel,
  PulumiResourceProgress,
  PulumiStackOutputs,
} from './types/pulumi.types';

type DeploymentWithEnvironment = Deployment & {
  environment: {
    id: string;
    name: string;
    doAccount: {
      doToken: string;
      region: string;
    };
    project: {
      id: string;
      name: string;
    };
  };
};

type EnvironmentWithProvisioningData = {
  id: string;
  doAccountId: string;
  name: string;
  configYaml: string | null;
  configParsed: Prisma.JsonValue | null;
  doAccount: {
    doToken: string;
    region: string;
  };
  project: {
    id: string;
    name: string;
  };
  pulumiStack: {
    stackName: string;
  } | null;
  deployments: Array<{
    imageUri: string | null;
  }>;
};

const SUPPORTED_DO_REGIONS = [
  'nyc1',
  'nyc3',
  'sfo2',
  'sfo3',
  'ams3',
  'sgp1',
  'lon1',
  'fra1',
  'tor1',
  'blr1',
  'syd1',
] as const;

/**
 * Processes infrastructure provisioning and destruction queue jobs.
 */
@Injectable()
@Processor(QUEUE_NAMES.INFRASTRUCTURE)
export class InfrastructureProcessor extends WorkerHost {
  private readonly logger = new Logger(InfrastructureProcessor.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly doApiService: DoApiService,
    private readonly pulumiRunnerService: PulumiRunnerService,
    private readonly eventsGateway: EventsGateway,
    private readonly variablesService: VariablesService,
  ) {
    super();
  }

  /**
   * Routes queue jobs to the corresponding infrastructure handler.
   */
  public async process(job: Job, _token?: string): Promise<void> {
    if (job.name === JOB_NAMES.INFRASTRUCTURE.PROVISION) {
      await this.handleProvision(job as Job<InfraProvisionJobPayload>);
      return;
    }

    if (job.name === JOB_NAMES.INFRASTRUCTURE.DESTROY) {
      await this.handleDestroy(job as Job<InfraDestroyJobPayload>);
      return;
    }

    this.logger.warn(`Ignoring unsupported infrastructure job: ${job.name}`);
  }

  /**
   * Provisions infrastructure for a deployment after image build/push succeeds.
   */
  private async handleProvision(job: Job<InfraProvisionJobPayload>): Promise<void> {
    const deployment = await this.getDeploymentForProvision(job.data);
    const stackName = this.buildStackName(deployment.environment.project.id, deployment.environment.name);
    const stateSpacesKey = this.buildStateSpacesKey(stackName);
    const doToken = this.decryptDoToken(deployment.environment.doAccount.doToken);
    const config = this.parseLiftoffConfig(job.data.configYaml);

    await this.prismaService.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.PROVISIONING,
        errorMessage: null,
        startedAt: deployment.startedAt ?? new Date(),
      },
    });
    this.broadcastDeploymentStatus(deployment.id, DeploymentStatus.PROVISIONING);

    const serviceImages = job.data.bundleId
      ? await this.resolveServiceImagesFromBundle(job.data.bundleId)
      : this.resolveServiceImagesSingle(config, job.data.imageUri);
    const serviceVariables = await this.resolveServiceVariablesForEnv(deployment.environment.id);

    const stackArgs: AppPlatformStackArgs = {
      projectName: deployment.environment.project.name,
      projectId: deployment.environment.project.id,
      environmentName: deployment.environment.name,
      environmentId: deployment.environment.id,
      doRegion: deployment.environment.doAccount.region,
      doToken,
      config,
      serviceImages,
      serviceVariables,
    };

    const runResult = await this.runProvisionWithTimeout(deployment.id, {
      stackName,
      doToken,
      args: stackArgs,
      onLog: (line, level) => {
        void this.persistDeploymentLog(deployment.id, line, level).catch((error) => {
          this.logger.error(this.resolveErrorMessage(error));
        });
      },
      onResourceProgress: (progress) => {
        this.broadcastInfraProgress(deployment.id, progress);
      },
    });

    // Collect all deployments covered by this bundle (single-row fallback if no bundle).
    const bundleDeploymentIds = job.data.bundleId
      ? (
          await this.prismaService.deployment.findMany({
            where: { bundleId: job.data.bundleId },
            select: { id: true },
          })
        ).map((d) => d.id)
      : [deployment.id];

    if (!runResult.success) {
      const errorMessage = this.sanitizeErrorMessage(
        runResult.error ?? 'Pulumi provisioning failed',
      );

      await this.prismaService.deployment.updateMany({
        where: { id: { in: bundleDeploymentIds } },
        data: {
          status: DeploymentStatus.FAILED,
          errorMessage,
          completedAt: new Date(),
        },
      });
      if (job.data.bundleId) {
        await this.prismaService.deploymentBundle.update({
          where: { id: job.data.bundleId },
          data: {
            status: 'FAILED',
            errorMessage,
            completedAt: new Date(),
          },
        });
      }
      for (const deploymentId of bundleDeploymentIds) {
        this.broadcastDeploymentStatus(deploymentId, DeploymentStatus.FAILED);
        this.eventsGateway.broadcastDeploymentComplete({
          deploymentId,
          status: DeploymentStatus.FAILED as DeploymentStatusType,
        });
      }

      throw Exceptions.internalError(errorMessage, ErrorCodes.PULUMI_EXECUTION_FAILED);
    }

    const outputs = this.assertRequiredOutputs(runResult.outputs);
    const resourceTags = this.createResourceTags(
      deployment.environment.project.name,
      deployment.environment.name,
    );

    await this.prismaService.$transaction(async (transaction) => {
      await transaction.pulumiStack.upsert({
        where: { environmentId: deployment.environment.id },
        create: {
          environmentId: deployment.environment.id,
          stackName,
          stateSpacesKey,
          outputs: this.toJsonObject(outputs),
          lastUpdated: new Date(),
        },
        update: {
          stackName,
          stateSpacesKey,
          outputs: this.toJsonObject(outputs),
          lastUpdated: new Date(),
        },
      });

      await transaction.infrastructureResource.deleteMany({
        where: { environmentId: deployment.environment.id },
      });

      const resources = this.buildInfrastructureResources(
        deployment.environment.id,
        deployment.environment.doAccount.region,
        outputs,
        resourceTags,
      );
      if (resources.length > 0) {
        await transaction.infrastructureResource.createMany({
          data: resources,
        });
      }

      // Mark every bundle deployment as DEPLOYING then SUCCESS (Pulumi's
      // app create already includes its own initial deployment, so SUCCESS
      // immediately follows once outputs are in).
      await transaction.deployment.updateMany({
        where: { id: { in: bundleDeploymentIds } },
        data: {
          status: DeploymentStatus.DEPLOYING,
          endpoint: outputs.appUrl,
          errorMessage: null,
        },
      });
    });

    for (const deploymentId of bundleDeploymentIds) {
      this.broadcastDeploymentStatus(deploymentId, DeploymentStatus.DEPLOYING);
    }

    await this.prismaService.deployment.updateMany({
      where: { id: { in: bundleDeploymentIds } },
      data: {
        status: DeploymentStatus.SUCCESS,
        endpoint: outputs.appUrl,
        errorMessage: null,
        completedAt: new Date(),
      },
    });

    if (job.data.bundleId) {
      await this.prismaService.deploymentBundle.update({
        where: { id: job.data.bundleId },
        data: {
          status: 'SUCCESS',
          completedAt: new Date(),
        },
      });
    }

    for (const deploymentId of bundleDeploymentIds) {
      this.broadcastDeploymentStatus(deploymentId, DeploymentStatus.SUCCESS);
      this.eventsGateway.broadcastDeploymentComplete({
        deploymentId,
        status: DeploymentStatus.SUCCESS as DeploymentStatusType,
        endpoint: outputs.appUrl,
      });
    }
  }

  /**
   * Resolves runtime variables (vault env-scoped + service-scoped) for every
   * Service in the env. Returns a map keyed by service name — matches what
   * `AppPlatformStackArgs.serviceVariables` expects.
   */
  private async resolveServiceVariablesForEnv(
    environmentId: string,
  ): Promise<Record<string, AppPlatformVariable[]>> {
    const services = await this.prismaService.service.findMany({
      where: { environmentId, deletedAt: null },
      select: { id: true, name: true },
    });

    const result: Record<string, AppPlatformVariable[]> = {};
    for (const service of services) {
      const entries = await this.variablesService.resolveRuntimeVariablesForService(service.id);
      result[service.name] = entries.map((entry) => ({
        key: entry.key,
        value: entry.value ?? '',
        kind: entry.kind === 'SECRET' ? 'secret' : 'plain',
      }));
    }
    return result;
  }

  /**
   * Reads a DeploymentBundle's per-Service Deployments and builds the
   * `serviceName → imageUri` map the Pulumi component expects.
   */
  private async resolveServiceImagesFromBundle(
    bundleId: string,
  ): Promise<Record<string, string>> {
    const deployments = await this.prismaService.deployment.findMany({
      where: { bundleId },
      include: { service: { select: { name: true } } },
    });

    const serviceImages: Record<string, string> = {};
    for (const deployment of deployments) {
      if (!deployment.service || !deployment.imageUri) {
        continue;
      }
      serviceImages[deployment.service.name] = deployment.imageUri;
    }

    if (Object.keys(serviceImages).length === 0) {
      throw Exceptions.internalError(
        `DeploymentBundle ${bundleId} has no usable per-service images`,
        ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND,
      );
    }

    return serviceImages;
  }

  /**
   * Destroys an environment stack and clears tracked infrastructure records.
   */
  private async handleDestroy(job: Job<InfraDestroyJobPayload>): Promise<void> {
    const environment = await this.getEnvironmentForDestroy(job.data.environmentId);
    const doToken = this.decryptDoToken(environment.doAccount.doToken);
    const stackName =
      environment.pulumiStack?.stackName ??
      this.buildStackName(environment.project.id, environment.name);
    const config = this.resolveDestroyConfig(environment);
    const imageUri = await this.resolveImageUri(environment, doToken);
    const serviceImages = this.resolveServiceImagesSingle(config, imageUri);
    const serviceVariables = await this.resolveServiceVariablesForEnv(environment.id);

    const stackArgs: AppPlatformStackArgs = {
      projectName: environment.project.name,
      projectId: environment.project.id,
      environmentName: environment.name,
      environmentId: environment.id,
      doRegion: environment.doAccount.region,
      doToken,
      config,
      serviceImages,
      serviceVariables,
    };

    await this.pulumiRunnerService.destroy({
      stackName,
      doToken,
      args: stackArgs,
      onLog: (line, level) => {
        this.logger.log(`[infra:destroy:${level}] ${line}`);
      },
    });

    await this.prismaService.$transaction(async (transaction) => {
      await transaction.infrastructureResource.deleteMany({
        where: { environmentId: environment.id },
      });

      if (environment.pulumiStack) {
        await transaction.pulumiStack.update({
          where: { environmentId: environment.id },
          data: {
            outputs: Prisma.JsonNull,
            lastUpdated: new Date(),
          },
        });
      }
    });
  }

  private async getDeploymentForProvision(
    payload: InfraProvisionJobPayload,
  ): Promise<DeploymentWithEnvironment> {
    const deployment = await this.prismaService.deployment.findFirst({
      where: {
        id: payload.deploymentId,
        environmentId: payload.environmentId,
      },
      include: {
        environment: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
              },
            },
            doAccount: {
              select: {
                doToken: true,
                region: true,
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

  private async getEnvironmentForDestroy(environmentId: string): Promise<EnvironmentWithProvisioningData> {
    const environment = await this.prismaService.environment.findFirst({
      where: {
        id: environmentId,
        deletedAt: null,
      },
      select: {
        id: true,
        doAccountId: true,
        name: true,
        configYaml: true,
        configParsed: true,
        doAccount: {
          select: {
            doToken: true,
            region: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        pulumiStack: {
          select: {
            stackName: true,
          },
        },
        deployments: {
          where: {
            imageUri: {
              not: null,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            imageUri: true,
          },
        },
      },
    });

    if (!environment) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }

    return environment;
  }

  private resolveDestroyConfig(environment: EnvironmentWithProvisioningData): LiftoffConfigV2 {
    if (environment.configParsed !== null) {
      const parsedResult = safeParseLiftoffConfigAny(environment.configParsed);
      if (parsedResult.success) {
        return parsedResult.data;
      }
    }

    if (environment.configYaml) {
      return this.parseLiftoffConfig(environment.configYaml);
    }

    // Fall back to a minimal v2 stub so we can still target the env's App when no
    // config is recoverable (e.g. orphan rows from older releases).
    return {
      version: '2.0',
      services: [
        {
          name: environment.project.name,
          type: 'service',
          runtime: {
            instance_size: 'apps-s-1vcpu-0.5gb',
            replicas: 1,
            port: 3000,
          },
          build: {
            strategy: 'auto',
            dockerfile_path: 'Dockerfile',
            context: '.',
          },
          routes: [{ path: '/' }],
          env: {},
          secrets: [],
        },
      ],
      database: {
        enabled: false,
        engine: 'postgres',
        version: '15',
        size: 'db-s-1vcpu-1gb',
      },
      storage: {
        enabled: false,
      },
    };
  }

  /**
   * Phase 1 helper: build a single-entry serviceImages map keyed by the v2
   * config's first service. Multi-service builds in Phase 1.8 will populate
   * all entries from per-matrix-build deploy-complete callbacks.
   */
  private resolveServiceImagesSingle(
    config: LiftoffConfigV2,
    imageUri: string,
  ): Record<string, string> {
    const firstService = config.services[0];
    if (!firstService) {
      throw Exceptions.internalError(
        'LiftoffConfig v2 must contain at least one service',
        ErrorCodes.CONFIG_VALIDATION_FAILED,
      );
    }
    return { [firstService.name]: imageUri };
  }

  private async resolveImageUri(
    environment: EnvironmentWithProvisioningData,
    doToken: string,
  ): Promise<string> {
    const latestImageUri = environment.deployments[0]?.imageUri;
    if (latestImageUri) {
      return latestImageUri;
    }

    const registryName = await this.doApiService.getOrCreateContainerRegistryName(
      doToken,
      environment.doAccountId,
    );
    return `registry.digitalocean.com/${registryName}/${environment.project.name}/${environment.name}:latest`;
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

  private parseLiftoffConfig(configYaml: string): LiftoffConfigV2 {
    let parsedYaml: unknown;
    try {
      parsedYaml = yaml.load(configYaml);
    } catch {
      throw Exceptions.badRequest('Invalid liftoff.yml YAML syntax', ErrorCodes.CONFIG_INVALID_YAML);
    }

    const parsedConfig = safeParseLiftoffConfigAny(parsedYaml);
    if (!parsedConfig.success) {
      throw Exceptions.badRequest('liftoff.yml validation failed', ErrorCodes.CONFIG_VALIDATION_FAILED);
    }

    return parsedConfig.data;
  }

  private broadcastDeploymentStatus(deploymentId: string, status: DeploymentStatus): void {
    this.eventsGateway.broadcastDeploymentStatus({
      deploymentId,
      status: status as DeploymentStatusType,
      timestamp: new Date().toISOString(),
    });
  }

  private broadcastInfraProgress(
    deploymentId: string,
    progress: PulumiResourceProgress,
  ): void {
    this.eventsGateway.broadcastInfraProgress({
      deploymentId,
      resourceType: progress.resourceType,
      resourceName: progress.resourceName,
      action: progress.action,
      status: progress.status,
    });
  }

  private async persistDeploymentLog(
    deploymentId: string,
    line: string,
    level: PulumiLogLevel,
  ): Promise<void> {
    if (!line.trim()) {
      return;
    }

    const timestamp = new Date();
    await this.prismaService.deploymentLog.create({
      data: {
        deploymentId,
        message: line,
        level: this.toPrismaLogLevel(level),
        source: 'pulumi',
        timestamp,
      },
    });

    this.eventsGateway.broadcastDeploymentLog({
      deploymentId,
      line,
      timestamp: timestamp.toISOString(),
      level,
      source: 'pulumi',
    });
  }

  private toPrismaLogLevel(level: PulumiLogLevel): LogLevel {
    if (level === 'warn') {
      return LogLevel.WARN;
    }
    if (level === 'error') {
      return LogLevel.ERROR;
    }
    return LogLevel.INFO;
  }

  private async runProvisionWithTimeout(
    deploymentId: string,
    options: Parameters<PulumiRunnerService['run']>[0],
  ): Promise<Awaited<ReturnType<PulumiRunnerService['run']>>> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutMessage = `Infrastructure provisioning timed out after ${
      QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS / 60000
    } minutes`;

    try {
      return await Promise.race([
        this.pulumiRunnerService.run(options),
        new Promise<Awaited<ReturnType<PulumiRunnerService['run']>>>((resolve) => {
          timeoutHandle = setTimeout(() => {
            this.logger.error(`${timeoutMessage} (deploymentId=${deploymentId})`);
            resolve({
              success: false,
              outputs: {},
              error: timeoutMessage,
            });
          }, QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private assertRequiredOutputs(
    outputs: Partial<PulumiStackOutputs> | Record<string, unknown>,
  ): PulumiStackOutputs {
    const outputRecord = outputs as Record<string, unknown>;
    const appId = this.resolveOutputValue(outputRecord.appId);
    const appUrl = this.resolveOutputValue(outputRecord.appUrl);
    const repositoryUrl = this.resolveOutputValue(outputRecord.repositoryUrl);

    if (!appId || !appUrl || !repositoryUrl) {
      throw Exceptions.internalError(
        'Pulumi stack outputs are incomplete',
        ErrorCodes.PULUMI_EXECUTION_FAILED,
      );
    }

    return {
      appId,
      appUrl,
      repositoryUrl,
      dbClusterName: this.resolveOutputValue(outputRecord.dbClusterName),
      dbUri: this.resolveOutputValue(outputRecord.dbUri),
      bucketName: this.resolveOutputValue(outputRecord.bucketName),
      bucketEndpoint: this.resolveOutputValue(outputRecord.bucketEndpoint),
    };
  }

  private resolveOutputValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (value && typeof value === 'object' && 'value' in value) {
      const nestedValue = (value as { value?: unknown }).value;
      if (typeof nestedValue === 'string') {
        return nestedValue;
      }
      if (typeof nestedValue === 'number' || typeof nestedValue === 'boolean') {
        return String(nestedValue);
      }
    }

    return undefined;
  }

  private buildInfrastructureResources(
    environmentId: string,
    doRegion: string,
    outputs: PulumiStackOutputs,
    resourceTags: Prisma.JsonObject,
  ): Prisma.InfrastructureResourceCreateManyInput[] {
    const resources: Prisma.InfrastructureResourceCreateManyInput[] = [
      {
        environmentId,
        resourceType: 'digitalocean:index/app:App',
        resourceName: 'app-platform-app',
        doResourceId: outputs.appId,
        doRegion,
        tags: resourceTags,
      },
      {
        environmentId,
        resourceType: 'digitalocean:index/containerRegistryDockerCredentials:ContainerRegistryDockerCredentials',
        resourceName: 'registry-credentials',
        doResourceId: outputs.repositoryUrl,
        doRegion,
        tags: resourceTags,
      },
    ];

    if (outputs.dbClusterName) {
      resources.push({
        environmentId,
        resourceType: 'digitalocean:index/databaseCluster:DatabaseCluster',
        resourceName: 'managed-postgres',
        doResourceId: outputs.dbClusterName,
        doRegion,
        tags: resourceTags,
      });
    }

    if (outputs.bucketName) {
      resources.push({
        environmentId,
        resourceType: 'digitalocean:index/spacesBucket:SpacesBucket',
        resourceName: 'spaces-bucket',
        doResourceId: outputs.bucketName,
        doRegion,
        tags: resourceTags,
      });
    }

    return resources;
  }

  private createResourceTags(projectName: string, environmentName: string): Prisma.JsonObject {
    return {
      'liftoff-project': projectName,
      'liftoff-environment': environmentName,
      'liftoff-managed': 'true',
    };
  }

  private buildStackName(projectId: string, environmentName: string): string {
    return `organization/${projectId}/${environmentName}`;
  }

  private buildStateSpacesKey(stackName: string): string {
    return `.pulumi/stacks/${stackName}.json`;
  }

  private normalizeDoRegion(region: string): (typeof SUPPORTED_DO_REGIONS)[number] {
    const matchedRegion = SUPPORTED_DO_REGIONS.find((supportedRegion) => supportedRegion === region);
    return matchedRegion ?? 'nyc3';
  }

  private toJsonObject(outputs: PulumiStackOutputs): Prisma.JsonObject {
    const json: Prisma.JsonObject = {
      appUrl: outputs.appUrl,
      appId: outputs.appId,
      repositoryUrl: outputs.repositoryUrl,
    };

    if (outputs.dbClusterName) {
      json.dbClusterName = outputs.dbClusterName;
    }
    if (outputs.dbUri) {
      json.dbUri = outputs.dbUri;
    }
    if (outputs.bucketName) {
      json.bucketName = outputs.bucketName;
    }
    if (outputs.bucketEndpoint) {
      json.bucketEndpoint = outputs.bucketEndpoint;
    }

    return json;
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return this.sanitizeErrorMessage(error.message);
    }
    return 'Infrastructure processing failed';
  }

  private sanitizeErrorMessage(message: string): string {
    const withoutDoToken = message.replace(/dop_v1_[A-Za-z0-9]+/g, '[REDACTED_DO_TOKEN]');
    const withoutBearer = withoutDoToken.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
    return withoutBearer.length > 500 ? withoutBearer.slice(0, 500) : withoutBearer;
  }
}
