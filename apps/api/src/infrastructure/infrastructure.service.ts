import { InjectQueue } from '@nestjs/bullmq';
import {
  InfrastructureResource,
  Prisma,
  Role,
} from '@prisma/client';
import {
  ErrorCodes,
  type LiftoffConfigV2,
  safeParseLiftoffConfigAny,
} from '@liftoff/shared';
import { Queue } from 'bullmq';
import * as yaml from 'js-yaml';
import { Injectable } from '@nestjs/common';
import { Exceptions } from '../common/exceptions/app.exception';
import { EncryptionService } from '../common/services/encryption.service';
import { DoApiService } from '../do-api/do-api.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  InfraDestroyJobPayload,
  JOB_NAMES,
  QUEUE_NAMES,
} from '../queues/queue.constants';
import { ProjectsService } from '../projects/projects.service';
import { VariablesService } from '../variables/variables.service';
import { PulumiRunnerService } from './pulumi-runner.service';
import {
  AppPlatformStackArgs,
  AppPlatformVariable,
  PulumiPreviewResult,
} from './types/pulumi.types';

type EnvironmentPreviewContext = Prisma.EnvironmentGetPayload<{
  include: {
    project: {
      select: {
        id: true;
        name: true;
      };
    };
    doAccount: {
      select: {
        doToken: true;
        region: true;
      };
    };
    deployments: {
      where: {
        imageUri: {
          not: null;
        };
      };
      orderBy: {
        createdAt: 'desc';
      };
      take: 1;
      select: {
        imageUri: true;
      };
    };
  };
}>;

/**
 * Handles infrastructure preview, destroy queueing, and resource listing endpoints.
 */
@Injectable()
export class InfrastructureService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly encryptionService: EncryptionService,
    private readonly doApiService: DoApiService,
    private readonly pulumiRunnerService: PulumiRunnerService,
    private readonly variablesService: VariablesService,
    @InjectQueue(QUEUE_NAMES.INFRASTRUCTURE)
    private readonly infrastructureQueue: Queue<InfraDestroyJobPayload>,
  ) {}

  /**
   * Runs a Pulumi preview for an environment.
   */
  public async previewInfra(environmentId: string, userId: string): Promise<PulumiPreviewResult> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.project.id, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    const config = this.resolveEnvironmentConfig(environment);
    const doToken = this.decryptDoToken(environment.doAccount.doToken);
    const imageUri = await this.resolveImageUri(environment, doToken);
    const stackName = this.buildStackName(environment.project.id, environment.name);
    const firstService = config.services[0];
    if (!firstService) {
      throw Exceptions.badRequest(
        'LiftoffConfig must contain at least one service',
        ErrorCodes.CONFIG_VALIDATION_FAILED,
      );
    }
    // Phase 1 preview path: same single-image assumption as provision.
    const serviceImages: Record<string, string> = { [firstService.name]: imageUri };
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

    return this.pulumiRunnerService.preview({
      stackName,
      doToken,
      args: stackArgs,
    });
  }

  /**
   * Queues infrastructure destruction for an environment.
   */
  public async destroyInfra(environmentId: string, userId: string): Promise<void> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.project.id, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    await this.infrastructureQueue.add(
      JOB_NAMES.INFRASTRUCTURE.DESTROY,
      { environmentId },
      {
        attempts: 1,
      },
    );
  }

  /**
   * Returns persisted infrastructure resource records for an environment.
   */
  public async getResources(environmentId: string, userId: string): Promise<InfrastructureResource[]> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.project.id, userId);

    return this.prismaService.infrastructureResource.findMany({
      where: { environmentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getEnvironmentContext(environmentId: string): Promise<EnvironmentPreviewContext> {
    const environment = await this.prismaService.environment.findFirst({
      where: {
        id: environmentId,
        deletedAt: null,
      },
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

  private resolveEnvironmentConfig(environment: EnvironmentPreviewContext): LiftoffConfigV2 {
    if (environment.configParsed !== null) {
      const parsedResult = safeParseLiftoffConfigAny(environment.configParsed);
      if (parsedResult.success) {
        return parsedResult.data;
      }
    }

    if (!environment.configYaml) {
      throw Exceptions.badRequest(
        'Environment configuration is missing',
        ErrorCodes.CONFIG_MISSING_REQUIRED_FIELDS,
      );
    }

    let yamlPayload: unknown;
    try {
      yamlPayload = yaml.load(environment.configYaml);
    } catch {
      throw Exceptions.badRequest('Invalid liftoff.yml YAML syntax', ErrorCodes.CONFIG_INVALID_YAML);
    }

    const parsedConfig = safeParseLiftoffConfigAny(yamlPayload);
    if (!parsedConfig.success) {
      throw Exceptions.badRequest('liftoff.yml validation failed', ErrorCodes.CONFIG_VALIDATION_FAILED);
    }

    return parsedConfig.data;
  }

  private async resolveImageUri(
    environment: EnvironmentPreviewContext,
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
    return `registry.digitalocean.com/${registryName}/${environment.project.name}/${environment.name}:preview`;
  }

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

  private buildStackName(projectId: string, environmentName: string): string {
    return `organization/${projectId}/${environmentName}`;
  }
}
