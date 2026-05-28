import {
  DOAccount,
  Environment,
  Prisma,
  Role,
  ServiceType,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  DIGITALOCEAN_ACCESS_TOKEN_SECRET_NAME,
  ErrorCodes,
  type LiftoffConfig,
  resolveEnvironmentDeploySecretName,
  safeParseLiftoffConfig,
} from '@liftoff/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { ZodIssue } from 'zod';
import * as yaml from 'js-yaml';
import { AppException, Exceptions } from '../common/exceptions/app.exception';
import { EncryptionService } from '../common/services/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { GitHubService } from '../repositories/github.service';
import { ConfigYamlDto } from './dto/config-yaml.dto';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';

type ValidatedConfigResult =
  | {
      valid: true;
      parsedConfig: object;
    }
  | {
      valid: false;
      errorCode: 'CONFIG_INVALID_YAML' | 'CONFIG_VALIDATION_FAILED';
      errors: ConfigValidationIssue[];
    };

export type EnvironmentListItem = Prisma.EnvironmentGetPayload<{
  include: {
    _count: {
      select: {
        deployments: true;
      };
    };
  };
}>;

export type EnvironmentDetail = Prisma.EnvironmentGetPayload<{
  include: {
    pulumiStack: true;
    deployments: {
      take: 1;
      orderBy: {
        createdAt: 'desc';
      };
    };
  };
}>;

export interface ConfigValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ConfigValidationResponse {
  valid: boolean;
  errors?: ConfigValidationIssue[];
}

/**
 * Handles project-scoped environment lifecycle and liftoff.yml validation.
 */
@Injectable()
export class EnvironmentsService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly encryptionService: EncryptionService,
    private readonly githubService: GitHubService,
  ) {}

  /**
   * Creates an environment after project-role and DO account ownership checks.
   *
   * Also seeds the env's first Service row (one App Platform component named after the
   * project), so the canvas always shows at least one service node for a fresh env.
   * The Service inherits its runtime config from the default liftoff.yml so existing
   * pipelines (workflow generation, Pulumi compile) keep working unchanged.
   */
  public async create(
    projectId: string,
    userId: string,
    dto: CreateEnvironmentDto,
  ): Promise<Environment> {
    await this.projectsService.assertProjectRole(projectId, userId, [Role.OWNER, Role.ADMIN]);
    const doAccount = await this.assertDoAccountOwnership(dto.doAccountId, userId);

    const generatedDeploySecret = randomBytes(10).toString('hex');
    const liftoffDeploySecret = this.encryptionService.encrypt(generatedDeploySecret);
    const defaultConfig = this.buildDefaultEnvironmentConfig();

    const projectRepository = await this.prismaService.repository.findUnique({
      where: { projectId },
      select: { id: true },
    });

    let createdEnvironment: Environment;
    try {
      createdEnvironment = await this.prismaService.environment.create({
        data: {
          projectId,
          doAccountId: dto.doAccountId,
          name: dto.name,
          gitBranch: dto.gitBranch,
          liftoffDeploySecret,
          serviceType: this.toPrismaServiceType(dto.serviceType),
          configYaml: defaultConfig.configYaml,
          configParsed: defaultConfig.configParsed,
          services: {
            create: {
              repositoryId: projectRepository?.id ?? null,
              name: defaultConfig.configParsed.service.name,
              kind: 'SERVICE',
              sourceDir: defaultConfig.configParsed.build.context,
              buildStrategy: this.mapBuildStrategy(defaultConfig.configParsed.build.strategy),
              dockerfilePath: defaultConfig.configParsed.build.dockerfile_path,
              port: defaultConfig.configParsed.runtime.port,
              instanceSize: defaultConfig.configParsed.runtime.instance_size,
              replicas: defaultConfig.configParsed.runtime.replicas,
              routePath: '/',
              healthcheckPath: defaultConfig.configParsed.healthcheck.path,
            },
          },
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw Exceptions.conflict(
          'Environment name already exists for this project',
          ErrorCodes.ENVIRONMENT_NAME_TAKEN,
        );
      }
      throw error;
    }

    try {
      await this.syncRepositoryActionsSecretsIfConnected(
        projectId,
        createdEnvironment.id,
        generatedDeploySecret,
        doAccount.doToken,
      );
    } catch (error) {
      await this.prismaService.environment.delete({
        where: {
          id: createdEnvironment.id,
        },
      });
      throw error;
    }

    return createdEnvironment;
  }

  private mapBuildStrategy(strategy: 'auto' | 'dockerfile' | 'nixpacks'): 'AUTO' | 'DOCKERFILE' | 'NIXPACKS' {
    if (strategy === 'dockerfile') return 'DOCKERFILE';
    if (strategy === 'nixpacks') return 'NIXPACKS';
    return 'AUTO';
  }

  /**
   * Lists environments for a project with deployment counts.
   */
  public async findAll(projectId: string, userId: string): Promise<EnvironmentListItem[]> {
    await this.projectsService.assertProjectRole(projectId, userId);

    return this.prismaService.environment.findMany({
      where: {
        projectId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            deployments: true,
          },
        },
      },
    });
  }

  /**
   * Returns one environment with stack info and most recent deployment.
   */
  public async findOne(projectId: string, id: string, userId: string): Promise<EnvironmentDetail> {
    await this.projectsService.assertProjectRole(projectId, userId);

    const environment = await this.prismaService.environment.findFirst({
      where: {
        id,
        projectId,
        deletedAt: null,
      },
      include: {
        pulumiStack: true,
        deployments: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!environment) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }

    return environment;
  }

  /**
   * Updates environment metadata for OWNER/ADMIN roles.
   */
  public async update(
    projectId: string,
    id: string,
    userId: string,
    dto: UpdateEnvironmentDto,
  ): Promise<Environment> {
    await this.projectsService.assertProjectRole(projectId, userId, [Role.OWNER, Role.ADMIN]);
    const environment = await this.getEnvironmentOrThrow(projectId, id);

    if (dto.doAccountId && dto.doAccountId !== environment.doAccountId) {
      await this.assertDoAccountOwnership(dto.doAccountId, userId);
    }

    const updateData: Prisma.EnvironmentUpdateInput = {};
    if (dto.name !== undefined) {
      updateData.name = dto.name;
    }
    if (dto.gitBranch !== undefined) {
      updateData.gitBranch = dto.gitBranch;
    }
    if (dto.doAccountId !== undefined) {
      updateData.doAccount = {
        connect: {
          id: dto.doAccountId,
        },
      };
    }
    if (dto.serviceType !== undefined) {
      updateData.serviceType = this.toPrismaServiceType(dto.serviceType);
    }

    try {
      return await this.prismaService.environment.update({
        where: {
          id: environment.id,
        },
        data: updateData,
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw Exceptions.conflict(
          'Environment name already exists for this project',
          ErrorCodes.ENVIRONMENT_NAME_TAKEN,
        );
      }
      throw error;
    }
  }

  /**
   * Soft-deletes an environment for OWNER users.
   */
  public async delete(projectId: string, id: string, userId: string): Promise<void> {
    await this.projectsService.assertProjectRole(projectId, userId, [Role.OWNER]);
    const environment = await this.getEnvironmentOrThrow(projectId, id);

    await this.prismaService.environment.update({
      where: {
        id: environment.id,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  /**
   * Validates and stores liftoff.yml content and parsed config for an environment.
   */
  public async updateConfig(
    projectId: string,
    id: string,
    userId: string,
    configYaml: string,
  ): Promise<Environment> {
    await this.projectsService.assertProjectRole(projectId, userId, [Role.OWNER, Role.ADMIN]);
    const environment = await this.getEnvironmentOrThrow(projectId, id);
    const result = this.validateLiftoffConfig(configYaml);

    if (!result.valid) {
      const errorCode =
        result.errorCode === 'CONFIG_INVALID_YAML'
          ? ErrorCodes.CONFIG_INVALID_YAML
          : ErrorCodes.CONFIG_VALIDATION_FAILED;
      const message =
        result.errorCode === 'CONFIG_INVALID_YAML'
          ? 'Invalid liftoff.yml YAML syntax'
          : 'liftoff.yml validation failed';
      throw new AppException(message, HttpStatus.UNPROCESSABLE_ENTITY, errorCode, {
        errors: result.errors,
      });
    }

    return this.prismaService.environment.update({
      where: {
        id: environment.id,
      },
      data: {
        configYaml,
        configParsed: result.parsedConfig,
      },
    });
  }

  /**
   * Validates liftoff.yml content without persisting any database changes.
   */
  public async validateConfig(
    projectId: string,
    id: string,
    userId: string,
    dto: ConfigYamlDto,
  ): Promise<ConfigValidationResponse> {
    await this.projectsService.assertProjectRole(projectId, userId, [Role.OWNER, Role.ADMIN]);
    await this.getEnvironmentOrThrow(projectId, id);

    const result = this.validateLiftoffConfig(dto.configYaml);
    if (!result.valid) {
      return {
        valid: false,
        errors: result.errors,
      };
    }

    return {
      valid: true,
    };
  }

  private async getEnvironmentOrThrow(projectId: string, id: string): Promise<Environment> {
    const environment = await this.prismaService.environment.findFirst({
      where: {
        id,
        projectId,
        deletedAt: null,
      },
    });

    if (!environment) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }

    return environment;
  }

  private async assertDoAccountOwnership(
    doAccountId: string,
    userId: string,
  ): Promise<Pick<DOAccount, 'id' | 'doToken'>> {
    const doAccount = await this.prismaService.dOAccount.findFirst({
      where: {
        id: doAccountId,
        userId,
      },
      select: {
        id: true,
        doToken: true,
      },
    });

    if (!doAccount) {
      throw Exceptions.badRequest(
        'DigitalOcean account does not belong to the current user',
        ErrorCodes.DO_ACCOUNT_NOT_FOUND,
      );
    }

    return doAccount;
  }

  private buildDefaultEnvironmentConfig(): { configYaml: string; configParsed: LiftoffConfig } {
    const configYaml = [
      'version: "1.0"',
      'service:',
      '  name: test-app',
      '  type: app',
      '  region: nyc3',
      'runtime:',
      '  instance_size: apps-s-1vcpu-0.5gb',
      '  port: 3000',
      '  replicas: 1',
      'healthcheck:',
      '  path: /',
      'build:',
      '  strategy: auto',
      '  dockerfile_path: Dockerfile',
      '  context: .',
    ].join('\n');
    const parsedYaml = yaml.load(configYaml);

    const parsedConfig = safeParseLiftoffConfig(parsedYaml);
    if (!parsedConfig.success) {
      throw Exceptions.internalError(
        'Failed to generate default environment configuration',
        ErrorCodes.INTERNAL_ERROR,
      );
    }

    return {
      configYaml,
      configParsed: parsedConfig.data,
    };
  }

  private async syncRepositoryActionsSecretsIfConnected(
    projectId: string,
    environmentId: string,
    deploySecret: string,
    encryptedDoToken: string,
  ): Promise<void> {
    const projectRepositoryContext = await this.prismaService.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
      },
      select: {
        repository: {
          select: {
            fullName: true,
          },
        },
        user: {
          select: {
            githubToken: true,
          },
        },
      },
    });

    if (!projectRepositoryContext?.repository) {
      return;
    }

    const encryptedGithubToken = projectRepositoryContext.user.githubToken;
    if (!encryptedGithubToken) {
      throw Exceptions.badRequest(
        'Project owner GitHub token is missing. Reconnect the repository to continue.',
        ErrorCodes.REPOSITORY_ACCESS_DENIED,
      );
    }

    const githubToken = this.decryptGitHubToken(encryptedGithubToken);
    const deploySecretName = resolveEnvironmentDeploySecretName(environmentId);
    const doToken = this.decryptDoToken(encryptedDoToken);

    try {
      await this.githubService.upsertActionsSecret(
        githubToken,
        projectRepositoryContext.repository.fullName,
        deploySecretName,
        deploySecret,
      );
      await this.githubService.upsertActionsSecret(
        githubToken,
        projectRepositoryContext.repository.fullName,
        DIGITALOCEAN_ACCESS_TOKEN_SECRET_NAME,
        doToken,
      );
    } catch (error) {
      throw this.resolveActionsSecretSyncError(error);
    }
  }

  private decryptGitHubToken(encryptedGithubToken: string): string {
    try {
      return this.encryptionService.decrypt(encryptedGithubToken);
    } catch {
      throw Exceptions.internalError(
        'Stored GitHub token cannot be decrypted',
        ErrorCodes.INTERNAL_ERROR,
      );
    }
  }

  private decryptDoToken(encryptedDoToken: string): string {
    try {
      return this.encryptionService.decrypt(encryptedDoToken);
    } catch {
      throw Exceptions.internalError(
        'Stored DigitalOcean token cannot be decrypted',
        ErrorCodes.DO_ACCOUNT_VALIDATION_FAILED,
      );
    }
  }

  private resolveActionsSecretSyncError(error: unknown): AppException {
    const statusCode = this.resolveHttpStatus(error);
    const errorMessage = this.resolveGitHubErrorMessage(error)?.toLowerCase() ?? '';

    if (
      statusCode === HttpStatus.FORBIDDEN &&
      (errorMessage.includes('actions') ||
        errorMessage.includes('secret') ||
        errorMessage.includes('resource not accessible'))
    ) {
      return new AppException(
        'GitHub token is missing Actions secret permissions. Reconnect the repository to continue.',
        HttpStatus.BAD_REQUEST,
        ErrorCodes.REPOSITORY_ACCESS_DENIED,
      );
    }

    if (statusCode === HttpStatus.NOT_FOUND || statusCode === HttpStatus.FORBIDDEN) {
      return new AppException(
        'Repository access was denied while configuring deployment secrets.',
        HttpStatus.BAD_REQUEST,
        ErrorCodes.REPOSITORY_ACCESS_DENIED,
      );
    }

    return new AppException(
      'Failed to configure GitHub Actions secrets for this environment',
      HttpStatus.BAD_GATEWAY,
      ErrorCodes.INTERNAL_ERROR,
    );
  }

  private validateLiftoffConfig(configYaml: string): ValidatedConfigResult {
    let parsedYaml: unknown;

    try {
      parsedYaml = yaml.load(configYaml);
    } catch {
      return {
        valid: false,
        errorCode: 'CONFIG_INVALID_YAML',
        errors: [
          {
            path: 'root',
            code: 'invalid_yaml',
            message: 'Invalid YAML syntax',
          },
        ],
      };
    }

    const result = safeParseLiftoffConfig(parsedYaml);
    if (!result.success) {
      return {
        valid: false,
        errorCode: 'CONFIG_VALIDATION_FAILED',
        errors: this.mapZodIssues(result.errors),
      };
    }

    return {
      valid: true,
      parsedConfig: result.data,
    };
  }

  private mapZodIssues(issues: ZodIssue[]): ConfigValidationIssue[] {
    return issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.map((pathItem) => String(pathItem)).join('.') : 'root',
      code: issue.code,
      message: issue.message,
    }));
  }

  private toPrismaServiceType(_serviceType: 'APP' | undefined): ServiceType {
    return ServiceType.APP;
  }

  private isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private resolveGitHubErrorMessage(error: unknown): string | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const maybeError = error as {
      response?: {
        data?: {
          message?: unknown;
        };
      };
    };

    const responseMessage = maybeError.response?.data?.message;
    return typeof responseMessage === 'string' ? responseMessage : null;
  }

  private resolveHttpStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const maybeError = error as {
      response?: {
        status?: unknown;
      };
    };

    return typeof maybeError.response?.status === 'number' ? maybeError.response.status : null;
  }
}
