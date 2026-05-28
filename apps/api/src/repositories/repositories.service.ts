import { BuildStrategy, Repository, Role } from '@prisma/client';
import {
  DIGITALOCEAN_ACCESS_TOKEN_SECRET_NAME,
  ErrorCodes,
  resolveEnvironmentDeploySecretName,
  safeParseLiftoffConfig,
} from '@liftoff/shared';
import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AppException, Exceptions } from '../common/exceptions/app.exception';
import { EncryptionService } from '../common/services/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ConnectRepositoryDto } from './dto/connect-repository.dto';
import { GitHubRepo, GitHubService } from './github.service';
import {
  ServiceBuildSpec,
  WorkflowGeneratorService,
} from './workflow-generator.service';

const WORKFLOW_FILE_PATH = '.github/workflows/liftoff-deploy.yml';

type ProjectEnvironmentSummary = {
  id: string;
  name: string;
  gitBranch: string;
  doAccountId: string;
  liftoffDeploySecret: string | null;
  configParsed: unknown;
};

/**
 * Connected repository response payload.
 */
export interface ConnectedRepository {
  id: string;
  projectId: string;
  githubId: number;
  fullName: string;
  cloneUrl: string;
  branch: string;
  webhookId: number | null;
  webhookStatus: 'active' | 'missing';
  workflowPath: string;
  workflowUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Handles project-level GitHub repository connection lifecycle.
 */
@Injectable()
export class RepositoriesService implements OnModuleInit {
  private readonly logger = new Logger(RepositoriesService.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly encryptionService: EncryptionService,
    private readonly githubService: GitHubService,
    private readonly workflowGeneratorService: WorkflowGeneratorService,
    private readonly configService: ConfigService,
  ) {}

  public async onModuleInit(): Promise<void> {
    try {
      await this.syncWebhookUrlsOnBoot();
    } catch {
      this.logger.warn('Repository webhook URL sync failed during startup');
    }
  }

  /**
   * Connects a GitHub repository, creates a webhook, and commits Liftoff workflow.
   */
  public async connect(
    projectId: string,
    userId: string,
    dto: ConnectRepositoryDto,
  ): Promise<ConnectedRepository> {
    await this.projectsService.assertProjectRole(projectId, userId, [Role.OWNER, Role.ADMIN]);

    const existingRepository = await this.prismaService.repository.findUnique({
      where: {
        projectId,
      },
    });
    if (existingRepository) {
      throw Exceptions.conflict(
        'A repository is already connected to this project',
        ErrorCodes.REPOSITORY_ALREADY_CONNECTED,
      );
    }

    const githubToken = await this.getDecryptedGitHubTokenOrThrow(userId);
    const githubRepository = await this.getRepositoryAccessOrThrow(githubToken, dto.fullName);
    if (githubRepository.id !== dto.githubRepoId) {
      throw Exceptions.badRequest('Repository selection is invalid', ErrorCodes.VALIDATION_ERROR);
    }

    const project = await this.getProjectWithEnvironmentsOrThrow(projectId);
    const targetEnvironment = project.environments.find(
      (environment) => environment.gitBranch === dto.branch,
    );
    if (!targetEnvironment) {
      throw Exceptions.badRequest(
        'No active environment is configured for this branch',
        ErrorCodes.ENVIRONMENT_NOT_FOUND,
      );
    }
    const doToken = await this.getDecryptedDoTokenForDoAccount(targetEnvironment.doAccountId, userId);

    const webhookSecret = randomBytes(20).toString('hex');
    const encryptedWebhookSecret = this.encryptionService.encrypt(webhookSecret);
    const webhookUrl = `${this.getWebhookBaseUrl()}/api/v1/webhooks/github`;

    let webhookId: number;
    try {
      webhookId = await this.githubService.createWebhook(
        githubToken,
        dto.fullName,
        webhookUrl,
        webhookSecret,
      );
    } catch {
      throw new AppException(
        'Failed to create GitHub webhook',
        HttpStatus.BAD_GATEWAY,
        ErrorCodes.REPOSITORY_WEBHOOK_CREATION_FAILED,
      );
    }

    const environmentSecrets = this.resolveEnvironmentSecrets(project.environments);

    let repository: Repository;
    try {
      repository = await this.prismaService.$transaction(async (transaction) => {
        const createdRepository = await transaction.repository.create({
          data: {
            projectId,
            githubId: githubRepository.id,
            fullName: githubRepository.fullName,
            cloneUrl: githubRepository.cloneUrl,
            branch: dto.branch,
            webhookId,
            webhookSecret: encryptedWebhookSecret,
          },
        });

        for (const environmentSecret of environmentSecrets) {
          if (!environmentSecret.encryptedSecret) {
            continue;
          }

          await transaction.environment.update({
            where: {
              id: environmentSecret.environmentId,
            },
            data: {
              liftoffDeploySecret: environmentSecret.encryptedSecret,
            },
          });
        }

        return createdRepository;
      });
    } catch (error) {
      await this.deleteWebhookIfPresent(githubToken, dto.fullName, webhookId);
      throw error;
    }

    try {
      const targetEnvironmentSecret = environmentSecrets.find(
        (environmentSecret) => environmentSecret.environmentId === targetEnvironment.id,
      );
      if (!targetEnvironmentSecret) {
        throw Exceptions.internalError(
          'Failed to resolve deploy secret for target environment',
          ErrorCodes.INTERNAL_ERROR,
        );
      }

      await this.githubService.upsertActionsSecret(
        githubToken,
        dto.fullName,
        resolveEnvironmentDeploySecretName(targetEnvironment.id),
        targetEnvironmentSecret.plainSecret,
      );
      await this.githubService.upsertActionsSecret(
        githubToken,
        dto.fullName,
        DIGITALOCEAN_ACCESS_TOKEN_SECRET_NAME,
        doToken,
      );

      const serviceBuildSpecs = await this.buildServiceBuildSpecs(
        targetEnvironment.id,
        project.name,
        targetEnvironment.name,
      );
      const workflowContent = await this.workflowGeneratorService.generate({
        projectName: project.name,
        environmentId: targetEnvironment.id,
        branch: dto.branch,
        liftoffApiUrl: this.getWebhookBaseUrl(),
        services: serviceBuildSpecs,
        doToken,
        doAccountId: targetEnvironment.doAccountId,
      });

      await this.githubService.commitFile(
        githubToken,
        dto.fullName,
        WORKFLOW_FILE_PATH,
        workflowContent,
        this.getWorkflowCommitMessage(),
        dto.branch,
      );
    } catch (error) {
      await this.deleteWebhookIfPresent(githubToken, dto.fullName, webhookId);
      await this.prismaService.repository.delete({
        where: {
          id: repository.id,
        },
      });

      this.logGitHubSetupErrorResponse(error);
      throw this.resolveRepositorySetupError(error);
    }

    return this.toConnectedRepository(repository);
  }

  /**
   * Disconnects a project repository and removes the GitHub webhook.
   */
  public async disconnect(projectId: string, userId: string): Promise<void> {
    await this.projectsService.assertProjectRole(projectId, userId, [Role.OWNER, Role.ADMIN]);

    const repository = await this.prismaService.repository.findUnique({
      where: {
        projectId,
      },
    });
    if (!repository) {
      return;
    }

    const githubToken = await this.getDecryptedGitHubTokenOrThrow(userId);
    if (repository.webhookId !== null) {
      try {
        await this.githubService.deleteWebhook(githubToken, repository.fullName, repository.webhookId);
      } catch (error) {
        if (!this.isHttpStatus(error, HttpStatus.NOT_FOUND)) {
          throw new AppException(
            'Failed to delete GitHub webhook',
            HttpStatus.BAD_GATEWAY,
            ErrorCodes.REPOSITORY_WEBHOOK_CREATION_FAILED,
          );
        }
      }
    }

    await this.prismaService.repository.delete({
      where: {
        projectId,
      },
    });
  }

  /**
   * Lists repositories available from the current user's GitHub account.
   */
  public async listAvailable(projectId: string, userId: string): Promise<GitHubRepo[]> {
    await this.projectsService.assertProjectRole(projectId, userId);
    const githubToken = await this.getDecryptedGitHubTokenOrThrow(userId);
    return this.githubService.listRepositories(githubToken);
  }

  /**
   * Returns the currently connected project repository, if any.
   */
  public async findByProject(projectId: string, userId: string): Promise<ConnectedRepository | null> {
    await this.projectsService.assertProjectRole(projectId, userId);

    const repository = await this.prismaService.repository.findUnique({
      where: {
        projectId,
      },
    });
    if (!repository) {
      return null;
    }

    return this.toConnectedRepository(repository);
  }

  /**
   * Regenerates `.github/workflows/liftoff-deploy.yml` in the user's repo with
   * a matrix entry for every current Service in the environment. Call this
   * after any structural change to the env's services (added/removed/renamed)
   * so the next push actually builds the right set of images.
   *
   * No-op when the project has no connected repository (the workflow file will
   * be generated at connect time using the then-current service list).
   */
  public async syncWorkflowForEnvironment(environmentId: string, userId: string): Promise<void> {
    const environment = await this.prismaService.environment.findFirst({
      where: { id: environmentId, deletedAt: null },
      select: {
        id: true,
        name: true,
        gitBranch: true,
        doAccountId: true,
        project: {
          select: {
            id: true,
            name: true,
            repository: {
              select: { id: true, fullName: true, branch: true },
            },
          },
        },
      },
    });

    if (!environment) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }

    const repository = environment.project.repository;
    if (!repository) {
      // No repo connected yet — workflow file gets created on first connect.
      this.logger.log(
        `syncWorkflowForEnvironment: skipping env ${environmentId} (no connected repository)`,
      );
      return;
    }

    const githubToken = await this.getDecryptedGitHubTokenOrThrow(userId);
    const doToken = await this.getDecryptedDoTokenForDoAccount(environment.doAccountId, userId);

    const serviceBuildSpecs = await this.buildServiceBuildSpecs(
      environment.id,
      environment.project.name,
      environment.name,
    );
    const workflowContent = await this.workflowGeneratorService.generate({
      projectName: environment.project.name,
      environmentId: environment.id,
      branch: repository.branch,
      liftoffApiUrl: this.getWebhookBaseUrl(),
      services: serviceBuildSpecs,
      doToken,
      doAccountId: environment.doAccountId,
    });

    await this.githubService.commitFile(
      githubToken,
      repository.fullName,
      WORKFLOW_FILE_PATH,
      workflowContent,
      `chore: sync Liftoff deploy workflow (${serviceBuildSpecs.length} service${
        serviceBuildSpecs.length === 1 ? '' : 's'
      })`,
      repository.branch,
    );

    this.logger.log(
      `Synced workflow file for env ${environmentId} (${serviceBuildSpecs.length} services)`,
    );
  }

  private decryptSecret(encryptedSecret: string): string {
    try {
      return this.encryptionService.decrypt(encryptedSecret);
    } catch {
      throw Exceptions.internalError(
        'Stored secret cannot be decrypted',
        ErrorCodes.INTERNAL_ERROR,
      );
    }
  }

  private toConnectedRepository(repository: Repository): ConnectedRepository {
    return {
      id: repository.id,
      projectId: repository.projectId,
      githubId: repository.githubId,
      fullName: repository.fullName,
      cloneUrl: repository.cloneUrl,
      branch: repository.branch,
      webhookId: repository.webhookId,
      webhookStatus: repository.webhookId ? 'active' : 'missing',
      workflowPath: WORKFLOW_FILE_PATH,
      workflowUrl: `https://github.com/${repository.fullName}/blob/${repository.branch}/${WORKFLOW_FILE_PATH}`,
      createdAt: repository.createdAt,
      updatedAt: repository.updatedAt,
    };
  }

  private getWebhookBaseUrl(): string {
    const webhookBaseUrl = this.configService.getOrThrow<string>('WEBHOOK_BASE_URL');
    return webhookBaseUrl.endsWith('/') ? webhookBaseUrl.slice(0, -1) : webhookBaseUrl;
  }

  private getWorkflowCommitMessage(): string {
    return [
      'chore: add Liftoff deploy workflow',
      '',
      'Managed GitHub Secrets (auto-upserted by Liftoff):',
      '- LIFTOFF_DEPLOY_SECRET',
      '- DIGITALOCEAN_ACCESS_TOKEN',
    ].join('\n');
  }

  private async getProjectWithEnvironmentsOrThrow(projectId: string): Promise<{
    id: string;
    name: string;
    environments: ProjectEnvironmentSummary[];
  }> {
    const project = await this.prismaService.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        environments: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            gitBranch: true,
            doAccountId: true,
            liftoffDeploySecret: true,
            configParsed: true,
          },
        },
      },
    });

    if (!project) {
      throw Exceptions.notFound('Project not found', ErrorCodes.PROJECT_NOT_FOUND);
    }

    return project;
  }

  private resolveEnvironmentSecrets(
    environments: ProjectEnvironmentSummary[],
  ): Array<{
    environmentId: string;
    plainSecret: string;
    encryptedSecret: string | null;
  }> {
    return environments.map((environment) => {
      if (!environment.liftoffDeploySecret) {
        const plainSecret = randomBytes(20).toString('hex');
        return {
          environmentId: environment.id,
          plainSecret,
          encryptedSecret: this.encryptionService.encrypt(plainSecret),
        };
      }

      const plainSecret = this.decryptSecret(environment.liftoffDeploySecret);
      return {
        environmentId: environment.id,
        plainSecret,
        encryptedSecret: null,
      };
    });
  }

  /**
   * Reads the env's Service rows and emits one ServiceBuildSpec per service so
   * the workflow generator can fan out into a matrix build. Single-service envs
   * (the Phase 1 common case) use `<project>/<env>` as the image repository so
   * pre-multi-service deployments and image-by-repository matching in
   * DeploymentProcessor keep working without a stack rebuild. Multi-service envs
   * scope each service's images under `<project>/<env>/<service>` so the spec
   * patcher can route the right tag to the right service entry.
   */
  private async buildServiceBuildSpecs(
    environmentId: string,
    projectName: string,
    environmentName: string,
  ): Promise<ServiceBuildSpec[]> {
    const services = await this.prismaService.service.findMany({
      where: { environmentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    if (services.length === 0) {
      throw Exceptions.internalError(
        'Environment has no services to build',
        ErrorCodes.INTERNAL_ERROR,
      );
    }

    const useNamespacedRepos = services.length > 1;
    return services.map((service) => ({
      name: service.name,
      context: service.sourceDir || '.',
      dockerfilePath: service.dockerfilePath || 'Dockerfile',
      buildStrategy: this.mapBuildStrategy(service.buildStrategy),
      imageRepository: useNamespacedRepos
        ? `${projectName}/${environmentName}/${service.name}`
        : `${projectName}/${environmentName}`,
    }));
  }

  private mapBuildStrategy(strategy: BuildStrategy): 'auto' | 'dockerfile' | 'nixpacks' {
    if (strategy === BuildStrategy.DOCKERFILE) return 'dockerfile';
    if (strategy === BuildStrategy.NIXPACKS) return 'nixpacks';
    return 'auto';
  }

  private async syncWebhookUrlsOnBoot(): Promise<void> {
    const repositories = await this.prismaService.repository.findMany({
      where: {
        webhookId: {
          not: null,
        },
      },
      select: {
        id: true,
        fullName: true,
        webhookId: true,
        project: {
          select: {
            user: {
              select: {
                githubToken: true,
              },
            },
          },
        },
      },
    });

    const webhookUrl = `${this.getWebhookBaseUrl()}/api/v1/webhooks/github`;

    for (const repository of repositories) {
      if (!repository.webhookId) {
        continue;
      }

      const encryptedGithubToken = repository.project.user.githubToken;
      if (!encryptedGithubToken) {
        this.logger.warn(
          `Skipping webhook sync for ${repository.fullName} because project owner GitHub token is missing`,
        );
        continue;
      }

      let githubToken: string;
      try {
        githubToken = this.encryptionService.decrypt(encryptedGithubToken);
      } catch {
        this.logger.warn(`Skipping webhook sync for ${repository.fullName} due to invalid GitHub token`);
        continue;
      }

      try {
        const existingWebhook = await this.githubService.getWebhook(
          githubToken,
          repository.fullName,
          repository.webhookId,
        );
        const normalizedWebhookUrl = this.trimTrailingSlash(existingWebhook.url);

        if (normalizedWebhookUrl === webhookUrl) {
          continue;
        }

        await this.githubService.updateWebhookUrl(
          githubToken,
          repository.fullName,
          repository.webhookId,
          webhookUrl,
        );
      } catch (error) {
        if (this.isHttpStatus(error, HttpStatus.NOT_FOUND)) {
          await this.prismaService.repository.update({
            where: {
              id: repository.id,
            },
            data: {
              webhookId: null,
            },
          });
          continue;
        }

        this.logger.warn(`Failed to sync webhook URL for ${repository.fullName}`);
      }
    }
  }

  private async getRepositoryAccessOrThrow(githubToken: string, fullName: string): Promise<GitHubRepo> {
    try {
      return await this.githubService.getRepository(githubToken, fullName);
    } catch (error) {
      if (this.isHttpStatus(error, HttpStatus.NOT_FOUND)) {
        throw Exceptions.badRequest(
          'Repository not found or not accessible by the current user',
          ErrorCodes.REPOSITORY_ACCESS_DENIED,
        );
      }

      if (this.isHttpStatus(error, HttpStatus.FORBIDDEN)) {
        throw Exceptions.badRequest(
          'Repository not found or not accessible by the current user',
          ErrorCodes.REPOSITORY_ACCESS_DENIED,
        );
      }

      throw error;
    }
  }

  private async getDecryptedGitHubTokenOrThrow(userId: string): Promise<string> {
    const user = await this.prismaService.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      select: {
        githubToken: true,
      },
    });

    if (!user) {
      throw Exceptions.notFound('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    if (!user.githubToken) {
      throw Exceptions.unauthorized(
        'GitHub token is missing. Please sign in again with GitHub.',
        ErrorCodes.AUTH_GITHUB_FAILED,
      );
    }

    try {
      return this.encryptionService.decrypt(user.githubToken);
    } catch {
      throw Exceptions.internalError(
        'Stored GitHub token cannot be decrypted',
        ErrorCodes.INTERNAL_ERROR,
      );
    }
  }

  private async getDecryptedDoTokenForDoAccount(doAccountId: string, userId: string): Promise<string> {
    const doAccount = await this.prismaService.dOAccount.findFirst({
      where: {
        id: doAccountId,
        userId,
      },
      select: {
        doToken: true,
      },
    });

    if (!doAccount) {
      throw Exceptions.badRequest(
        'DigitalOcean account for this environment could not be found',
        ErrorCodes.DO_ACCOUNT_NOT_FOUND,
      );
    }

    return this.decryptDoToken(doAccount.doToken);
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

  private async deleteWebhookIfPresent(
    githubToken: string,
    fullName: string,
    webhookId: number,
  ): Promise<void> {
    try {
      await this.githubService.deleteWebhook(githubToken, fullName, webhookId);
    } catch (error) {
      if (!this.isHttpStatus(error, HttpStatus.NOT_FOUND)) {
        throw error;
      }
    }
  }

  private resolveRepositorySetupError(error: unknown): AppException {
    const statusCode = this.resolveHttpStatus(error);
    const errorMessage = this.resolveGitHubErrorMessage(error)?.toLowerCase() ?? '';

    if (
      statusCode === HttpStatus.FORBIDDEN &&
      (errorMessage.includes('workflow') ||
        errorMessage.includes('actions') ||
        errorMessage.includes('secret') ||
        errorMessage.includes('resource not accessible'))
    ) {
      return new AppException(
        'GitHub token is missing workflow/actions permissions. Sign out and sign in again to grant required access.',
        HttpStatus.BAD_REQUEST,
        ErrorCodes.REPOSITORY_ACCESS_DENIED,
      );
    }

    if (statusCode === HttpStatus.UNPROCESSABLE_ENTITY) {
      return new AppException(
        'Unable to commit workflow file. Ensure the target branch exists and repository is initialized.',
        HttpStatus.BAD_REQUEST,
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    if (statusCode === HttpStatus.NOT_FOUND || statusCode === HttpStatus.FORBIDDEN) {
      return new AppException(
        'Repository write access was denied while configuring Liftoff secret/workflow.',
        HttpStatus.BAD_REQUEST,
        ErrorCodes.REPOSITORY_ACCESS_DENIED,
      );
    }

    return new AppException(
      'Failed to configure Liftoff repository automation',
      HttpStatus.BAD_GATEWAY,
      ErrorCodes.INTERNAL_ERROR,
    );
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

  private logGitHubSetupErrorResponse(error: unknown): void {
    if (!error || typeof error !== 'object') {
      return;
    }

    const maybeError = error as {
      response?: {
        data?: unknown;
      };
    };
    const responseData = maybeError.response?.data;
    if (typeof responseData === 'undefined') {
      return;
    }

    console.log('GitHub repository setup error response:', responseData);
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

  private isHttpStatus(error: unknown, statusCode: number): boolean {
    return this.resolveHttpStatus(error) === statusCode;
  }

  private trimTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }
}
