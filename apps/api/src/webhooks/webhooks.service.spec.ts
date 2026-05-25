import { DeploymentStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { EncryptionService } from '../common/services/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_NAMES, QUEUE_TIMEOUTS } from '../queues/queue.constants';
import { GitHubService } from '../repositories/github.service';
import { WebhooksService } from './webhooks.service';

/**
 * Unit tests for WebhooksService.
 */
describe('WebhooksService', () => {
  let service: WebhooksService;

  const prismaServiceMock = {
    repository: {
      findFirst: jest.fn(),
    },
    environment: {
      findFirst: jest.fn(),
    },
    deployment: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const encryptionServiceMock = {
    decrypt: jest.fn((_value: string) => 'decrypted-secret'),
  };

  const githubServiceMock = {
    verifyWebhookSignature: jest.fn(),
  };

  const deploymentsQueueMock = {
    add: jest.fn(),
  };

  const infrastructureQueueMock = {
    add: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhooksService(
      prismaServiceMock as unknown as PrismaService,
      encryptionServiceMock as unknown as EncryptionService,
      githubServiceMock as unknown as GitHubService,
      deploymentsQueueMock as unknown as Queue,
      infrastructureQueueMock as unknown as Queue,
    );
  });

  it('handleGitHubPush verifies signature and enqueues deployment job', async () => {
    prismaServiceMock.repository.findFirst.mockResolvedValue({
      id: 'repo-1',
      projectId: 'project-1',
      webhookSecret: 'encrypted-secret',
    });
    githubServiceMock.verifyWebhookSignature.mockReturnValue(true);
    prismaServiceMock.environment.findFirst.mockResolvedValue({ id: 'env-1' });
    prismaServiceMock.deployment.findFirst.mockResolvedValue(null);
    prismaServiceMock.deployment.create.mockResolvedValue({
      id: 'deployment-1',
      commitSha: 'abc123',
    });
    deploymentsQueueMock.add.mockResolvedValue(undefined);
    prismaServiceMock.deployment.update.mockResolvedValue(undefined);

    await service.handleGitHubPush(
      {
        ref: 'refs/heads/main',
        repository: { full_name: 'liftoff/my-app' },
        head_commit: { id: 'abc123', message: 'feat: deploy' },
      },
      'sha256=signature',
      Buffer.from('{"ref":"refs/heads/main"}', 'utf8'),
    );

    expect(githubServiceMock.verifyWebhookSignature).toHaveBeenCalled();
    expect(prismaServiceMock.deployment.create).toHaveBeenCalledWith({
      data: {
        environmentId: 'env-1',
        status: DeploymentStatus.PENDING,
        commitSha: 'abc123',
        commitMessage: 'feat: deploy',
        branch: 'main',
        triggeredBy: 'webhook',
      },
      select: {
        id: true,
        commitSha: true,
      },
    });
    expect(deploymentsQueueMock.add).toHaveBeenCalledWith(
      JOB_NAMES.DEPLOYMENTS.DEPLOY,
      {
        deploymentId: 'deployment-1',
        environmentId: 'env-1',
        commitSha: 'abc123',
      },
      expect.objectContaining({
        attempts: 3,
        timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      }),
    );
    expect(prismaServiceMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deployment-1' },
      data: { status: DeploymentStatus.QUEUED },
    });
  });

  it('handleGitHubPush throws on invalid signature', async () => {
    prismaServiceMock.repository.findFirst.mockResolvedValue({
      id: 'repo-1',
      projectId: 'project-1',
      webhookSecret: 'encrypted-secret',
    });
    githubServiceMock.verifyWebhookSignature.mockReturnValue(false);

    await expect(
      service.handleGitHubPush(
        {
          ref: 'refs/heads/main',
          repository: { full_name: 'liftoff/my-app' },
        },
        'sha256=invalid',
        Buffer.from('{}', 'utf8'),
      ),
    ).rejects.toThrow('Invalid webhook signature');
  });

  it('handleDeployComplete updates deployment and queues infrastructure job', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      configYaml: 'version: "1.0"',
      configParsed: null,
      liftoffDeploySecret: 'encrypted-deploy-secret',
      pulumiStack: null,
    });
    encryptionServiceMock.decrypt.mockReturnValue('deploy-secret');
    prismaServiceMock.deployment.findFirst.mockResolvedValue({
      id: 'deployment-1',
    });
    prismaServiceMock.deployment.update.mockResolvedValue(undefined);
    infrastructureQueueMock.add.mockResolvedValue(undefined);

    await service.handleDeployComplete(
      {
        environmentId: 'env-1',
        imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
        commitSha: 'abc123',
        buildStrategy: 'dockerfile',
        buildPlan: '{"mode":"dockerfile-first","fallback":"nixpacks"}',
      } as {
        environmentId: string;
        imageUri: string;
        commitSha: string;
        buildStrategy: string;
        buildPlan: string;
      },
      'deploy-secret',
    );

    expect(prismaServiceMock.deployment.findFirst).toHaveBeenCalledWith({
      where: {
        environmentId: 'env-1',
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
    expect(prismaServiceMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deployment-1' },
      data: expect.objectContaining({
        commitSha: 'abc123',
        imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
        buildStrategy: 'dockerfile',
        buildPlan: { mode: 'dockerfile-first', fallback: 'nixpacks' },
        status: DeploymentStatus.PROVISIONING,
      }),
    });
    expect(infrastructureQueueMock.add).toHaveBeenCalledWith(
      JOB_NAMES.INFRASTRUCTURE.PROVISION,
      {
        deploymentId: 'deployment-1',
        environmentId: 'env-1',
        imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
        configYaml: 'version: "1.0"',
      },
      expect.objectContaining({
        attempts: 3,
        timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      }),
    );
  });

  it('handleDeployComplete queues deployments processor job when stack outputs exist', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      configYaml: 'version: "1.0"',
      configParsed: null,
      liftoffDeploySecret: 'encrypted-deploy-secret',
      pulumiStack: {
        outputs: {
          appId: 'app-123',
          appUrl: 'https://my-app.ondigitalocean.app',
        },
      },
    });
    encryptionServiceMock.decrypt.mockReturnValue('deploy-secret');
    prismaServiceMock.deployment.findFirst.mockResolvedValue({
      id: 'deployment-1',
    });
    prismaServiceMock.deployment.update.mockResolvedValue(undefined);
    deploymentsQueueMock.add.mockResolvedValue(undefined);

    await service.handleDeployComplete(
      {
        environmentId: 'env-1',
        imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
        commitSha: 'abc123',
        buildStrategy: 'nixpacks',
        buildPlan: '{"provider":"nixpacks"}',
      } as {
        environmentId: string;
        imageUri: string;
        commitSha: string;
        buildStrategy: string;
        buildPlan: string;
      },
      'deploy-secret',
    );

    expect(prismaServiceMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deployment-1' },
      data: expect.objectContaining({
        commitSha: 'abc123',
        imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
        buildStrategy: 'nixpacks',
        buildPlan: { provider: 'nixpacks' },
        status: DeploymentStatus.DEPLOYING,
      }),
    });
    expect(deploymentsQueueMock.add).toHaveBeenCalledWith(
      JOB_NAMES.DEPLOYMENTS.DEPLOY,
      {
        deploymentId: 'deployment-1',
        environmentId: 'env-1',
        commitSha: 'abc123',
      },
      expect.objectContaining({
        attempts: 3,
        timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      }),
    );
    expect(infrastructureQueueMock.add).not.toHaveBeenCalled();
  });

  it('handleDeployComplete marks deployment as failed when environment config is missing', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      configYaml: null,
      configParsed: null,
      liftoffDeploySecret: 'encrypted-deploy-secret',
      pulumiStack: null,
    });
    encryptionServiceMock.decrypt.mockReturnValue('deploy-secret');
    prismaServiceMock.deployment.findFirst.mockResolvedValue({
      id: 'deployment-1',
    });
    prismaServiceMock.deployment.update.mockResolvedValue(undefined);

    await expect(
      service.handleDeployComplete(
        {
          environmentId: 'env-1',
          imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
          commitSha: 'abc123',
        },
        'deploy-secret',
      ),
    ).rejects.toThrow('Environment configuration is missing');

    expect(prismaServiceMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deployment-1' },
      data: expect.objectContaining({
        status: DeploymentStatus.FAILED,
        errorMessage: 'Environment configuration is missing',
      }),
    });
    expect(infrastructureQueueMock.add).not.toHaveBeenCalled();
  });

  it('handleDeployComplete marks deployment as failed when GitHub Actions job fails', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      configYaml: 'version: "1.0"',
      configParsed: null,
      liftoffDeploySecret: 'encrypted-deploy-secret',
      pulumiStack: null,
    });
    encryptionServiceMock.decrypt.mockReturnValue('deploy-secret');
    prismaServiceMock.deployment.findFirst.mockResolvedValue({
      id: 'deployment-1',
    });
    prismaServiceMock.deployment.update.mockResolvedValue(undefined);

    await service.handleDeployComplete(
      {
        environmentId: 'env-1',
        imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
        commitSha: 'abc123',
        status: 'failure',
        runUrl: 'https://github.com/user/repo/actions/runs/123456',
      },
      'deploy-secret',
    );

    expect(prismaServiceMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deployment-1' },
      data: expect.objectContaining({
        status: DeploymentStatus.FAILED,
        errorMessage: expect.stringContaining('Deployment failed during build/push phase'),
      }),
    });
    expect(infrastructureQueueMock.add).not.toHaveBeenCalled();
  });
});
