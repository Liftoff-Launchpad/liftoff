import { DeploymentStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { EncryptionService } from '../common/services/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_NAMES } from '../queues/queue.constants';
import { GitHubService } from '../repositories/github.service';
import { WebhooksService } from './webhooks.service';

/**
 * Unit tests for WebhooksService — current multi-service flow: a push creates a
 * DeploymentBundle with one Deployment per Service; deploy-complete updates the
 * matching service's Deployment.
 */
describe('WebhooksService', () => {
  let service: WebhooksService;

  const prismaServiceMock = {
    repository: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    environment: {
      findFirst: jest.fn(),
    },
    deployment: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    deploymentBundle: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    deploymentLog: {
      createMany: jest.fn(),
    },
  };

  const encryptionServiceMock = {
    decrypt: jest.fn((_value: string) => 'deploy-secret'),
  };

  const githubServiceMock = {
    verifyWebhookSignature: jest.fn(),
  };

  const deploymentsQueueMock = { add: jest.fn() };
  const infrastructureQueueMock = { add: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    // Phase F: the push handler resolves the project's primary repo to decide
    // whether the pushed repo adopts unassigned services.
    prismaServiceMock.repository.findFirst.mockResolvedValue({ id: 'r1' });
    service = new WebhooksService(
      prismaServiceMock as unknown as PrismaService,
      encryptionServiceMock as unknown as EncryptionService,
      githubServiceMock as unknown as GitHubService,
      deploymentsQueueMock as unknown as Queue,
      infrastructureQueueMock as unknown as Queue,
    );
  });

  const pushPayload = {
    ref: 'refs/heads/main',
    repository: { full_name: 'liftoff/my-app' },
    head_commit: { id: 'abc123', message: 'feat: deploy' },
  };

  it('handleGitHubPush matches the right secret across multiple candidate repos', async () => {
    prismaServiceMock.repository.findMany.mockResolvedValue([
      { id: 'r1', projectId: 'p1', webhookSecret: 's1' },
      { id: 'r2', projectId: 'p2', webhookSecret: 's2' },
    ]);
    // First candidate's secret doesn't match; second does.
    githubServiceMock.verifyWebhookSignature.mockReturnValueOnce(false).mockReturnValueOnce(true);
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      services: [{ id: 'svc-1', name: 'my-app' }],
    });
    prismaServiceMock.deployment.findFirst.mockResolvedValue(null);
    prismaServiceMock.deploymentBundle.create.mockResolvedValue({
      id: 'bundle-1',
      deployments: [{ id: 'dep-1' }],
    });
    deploymentsQueueMock.add.mockResolvedValue(undefined);
    prismaServiceMock.deployment.updateMany.mockResolvedValue(undefined);

    await service.handleGitHubPush(pushPayload, 'sha256=sig', Buffer.from('{}', 'utf8'));

    // Resolved to the SECOND project (the one whose secret matched).
    expect(prismaServiceMock.environment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: 'p2' }) }),
    );
    expect(prismaServiceMock.deploymentBundle.create).toHaveBeenCalled();
    expect(deploymentsQueueMock.add).toHaveBeenCalledWith(
      JOB_NAMES.DEPLOYMENTS.DEPLOY,
      expect.objectContaining({ deploymentId: 'dep-1', bundleId: 'bundle-1' }),
      expect.objectContaining({ jobId: 'dep-1' }),
    );
    expect(prismaServiceMock.deployment.updateMany).toHaveBeenCalledWith({
      where: { bundleId: 'bundle-1', status: DeploymentStatus.PENDING },
      data: { status: DeploymentStatus.QUEUED },
    });
  });

  it('handleGitHubPush throws when no candidate secret matches', async () => {
    prismaServiceMock.repository.findMany.mockResolvedValue([
      { id: 'r1', projectId: 'p1', webhookSecret: 's1' },
    ]);
    githubServiceMock.verifyWebhookSignature.mockReturnValue(false);

    await expect(
      service.handleGitHubPush(pushPayload, 'sha256=bad', Buffer.from('{}', 'utf8')),
    ).rejects.toThrow('Invalid webhook signature');
    expect(prismaServiceMock.deploymentBundle.create).not.toHaveBeenCalled();
  });

  it('handleGitHubPush ignores pushes with no matching environment', async () => {
    prismaServiceMock.repository.findMany.mockResolvedValue([
      { id: 'r1', projectId: 'p1', webhookSecret: 's1' },
    ]);
    githubServiceMock.verifyWebhookSignature.mockReturnValue(true);
    prismaServiceMock.environment.findFirst.mockResolvedValue(null);

    await service.handleGitHubPush(pushPayload, 'sha256=sig', Buffer.from('{}', 'utf8'));

    expect(prismaServiceMock.deploymentBundle.create).not.toHaveBeenCalled();
  });

  it('handleGitHubPush ignores envs with no service rows', async () => {
    prismaServiceMock.repository.findMany.mockResolvedValue([
      { id: 'r1', projectId: 'p1', webhookSecret: 's1' },
    ]);
    githubServiceMock.verifyWebhookSignature.mockReturnValue(true);
    prismaServiceMock.environment.findFirst.mockResolvedValue({ id: 'env-1', services: [] });

    await service.handleGitHubPush(pushPayload, 'sha256=sig', Buffer.from('{}', 'utf8'));

    expect(prismaServiceMock.deploymentBundle.create).not.toHaveBeenCalled();
  });

  it('handleGitHubPush (multi-repo) only deploys services owned by the pushed repo', async () => {
    // Push is from r2, but the project's primary repo is r1 — so r2 must NOT
    // adopt unassigned (null repositoryId) services.
    prismaServiceMock.repository.findMany.mockResolvedValue([
      { id: 'r2', projectId: 'p1', webhookSecret: 's2' },
    ]);
    githubServiceMock.verifyWebhookSignature.mockReturnValue(true);
    prismaServiceMock.repository.findFirst.mockResolvedValue({ id: 'r1' });
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      services: [{ id: 'svc-2', name: 'api' }],
    });
    prismaServiceMock.deployment.findFirst.mockResolvedValue(null);
    prismaServiceMock.deploymentBundle.create.mockResolvedValue({
      id: 'bundle-1',
      deployments: [{ id: 'dep-2' }],
    });
    deploymentsQueueMock.add.mockResolvedValue(undefined);
    prismaServiceMock.deployment.updateMany.mockResolvedValue(undefined);

    await service.handleGitHubPush(pushPayload, 'sha256=sig', Buffer.from('{}', 'utf8'));

    const call = prismaServiceMock.environment.findFirst.mock.calls[0]![0] as {
      select: { services: { where: unknown } };
    };
    expect(call.select.services.where).toEqual({ deletedAt: null, repositoryId: 'r2' });
  });

  it('handleGitHubPush (primary repo) also deploys unassigned services', async () => {
    prismaServiceMock.repository.findMany.mockResolvedValue([
      { id: 'r1', projectId: 'p1', webhookSecret: 's1' },
    ]);
    githubServiceMock.verifyWebhookSignature.mockReturnValue(true);
    prismaServiceMock.repository.findFirst.mockResolvedValue({ id: 'r1' });
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      services: [{ id: 'svc-1', name: 'web' }],
    });
    prismaServiceMock.deployment.findFirst.mockResolvedValue(null);
    prismaServiceMock.deploymentBundle.create.mockResolvedValue({
      id: 'bundle-1',
      deployments: [{ id: 'dep-1' }],
    });
    deploymentsQueueMock.add.mockResolvedValue(undefined);
    prismaServiceMock.deployment.updateMany.mockResolvedValue(undefined);

    await service.handleGitHubPush(pushPayload, 'sha256=sig', Buffer.from('{}', 'utf8'));

    const call = prismaServiceMock.environment.findFirst.mock.calls[0]![0] as {
      select: { services: { where: unknown } };
    };
    expect(call.select.services.where).toEqual({
      deletedAt: null,
      OR: [{ repositoryId: 'r1' }, { repositoryId: null }],
    });
  });

  it('handleDeployComplete marks the service deployment FAILED on a build failure', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      configYaml: 'version: "2.0"',
      configParsed: null,
      liftoffDeploySecret: 'encrypted-deploy-secret',
      pulumiStack: null,
      services: [{ id: 'svc-1', name: 'my-app' }],
    });
    encryptionServiceMock.decrypt.mockReturnValue('deploy-secret');
    prismaServiceMock.deployment.findFirst.mockResolvedValue({ id: 'deployment-1', bundleId: null });
    prismaServiceMock.deployment.update.mockResolvedValue(undefined);

    await service.handleDeployComplete(
      {
        environmentId: 'env-1',
        serviceName: 'my-app',
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
        errorMessage: expect.stringContaining('Build/push'),
      }),
    });
    expect(infrastructureQueueMock.add).not.toHaveBeenCalled();
  });

  it('handleDeployComplete throws when no in-flight deployment exists for the service', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      configYaml: 'version: "2.0"',
      configParsed: null,
      liftoffDeploySecret: 'encrypted-deploy-secret',
      pulumiStack: null,
      services: [{ id: 'svc-1', name: 'my-app' }],
    });
    encryptionServiceMock.decrypt.mockReturnValue('deploy-secret');
    prismaServiceMock.deployment.findFirst.mockResolvedValue(null);

    await expect(
      service.handleDeployComplete(
        {
          environmentId: 'env-1',
          serviceName: 'my-app',
          imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
          commitSha: 'abc123',
        },
        'deploy-secret',
      ),
    ).rejects.toThrow('No deployment in QUEUED, BUILDING, or PUSHING state');
  });
});
