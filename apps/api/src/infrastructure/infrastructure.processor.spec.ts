import { DeploymentStatus, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { EncryptionService } from '../common/services/encryption.service';
import { DoApiService } from '../do-api/do-api.service';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_NAMES } from '../queues/queue.constants';
import { PulumiRunnerService } from './pulumi-runner.service';
import { InfrastructureProcessor } from './infrastructure.processor';

const now = new Date('2025-01-01T00:00:00.000Z');

const validConfigYaml = `
version: "1.0"
service:
  name: my-app
  type: app
  region: nyc3
runtime:
  instance_size: apps-s-1vcpu-0.5gb
  replicas: 1
  port: 3000
`;

const createJob = <T>(name: string, data: T): Job<T> =>
  ({
    name,
    data,
  }) as unknown as Job<T>;

const buildProvisionDeployment = () => ({
  id: 'deploy-1',
  environmentId: 'env-1',
  status: DeploymentStatus.PUSHING,
  commitSha: 'abc123',
  commitMessage: 'feat: deploy',
  branch: 'main',
  imageUri: null,
  triggeredBy: 'webhook',
  endpoint: null,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
  environment: {
    id: 'env-1',
    name: 'production',
    doAccount: {
      doToken: 'encrypted-token',
      region: 'nyc3',
    },
    project: {
      id: 'project-1',
      name: 'my-app',
    },
  },
});

const buildDestroyEnvironment = () => ({
  id: 'env-1',
  doAccountId: 'do-1',
  name: 'production',
  configYaml: validConfigYaml,
  configParsed: null,
  doAccount: {
    doToken: 'encrypted-token',
    region: 'nyc3',
  },
  project: {
    id: 'project-1',
    name: 'my-app',
  },
  pulumiStack: {
    stackName: 'organization/project-1/production',
  },
  deployments: [
    {
      imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
    },
  ],
});

/**
 * Unit tests for InfrastructureProcessor.
 */
describe('InfrastructureProcessor', () => {
  let processor: InfrastructureProcessor;

  const transactionMock = {
    pulumiStack: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    infrastructureResource: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    deployment: {
      update: jest.fn(),
    },
  };

  const prismaServiceMock = {
    deployment: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    environment: {
      findFirst: jest.fn(),
    },
    deploymentLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(
      async (
        callback: (transaction: typeof transactionMock) => Promise<void>,
      ): Promise<void> => callback(transactionMock),
    ),
  };

  const encryptionServiceMock = {
    decrypt: jest.fn((_encrypted: string) => 'dop_v1_real_token'),
  };

  const doApiServiceMock = {
    getOrCreateContainerRegistryName: jest.fn(),
  };

  const pulumiRunnerServiceMock = {
    run: jest.fn(),
    destroy: jest.fn(),
  };

  const eventsGatewayMock = {
    broadcastDeploymentStatus: jest.fn(),
    broadcastDeploymentLog: jest.fn(),
    broadcastDeploymentComplete: jest.fn(),
    broadcastInfraProgress: jest.fn(),
  };

  const variablesServiceMock = {
    resolveRuntimeVariablesForService: jest.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new InfrastructureProcessor(
      prismaServiceMock as unknown as PrismaService,
      encryptionServiceMock as unknown as EncryptionService,
      doApiServiceMock as unknown as DoApiService,
      pulumiRunnerServiceMock as unknown as PulumiRunnerService,
      eventsGatewayMock as unknown as EventsGateway,
      variablesServiceMock as never,
    );
  });

  it('process handles infrastructure provision and marks deployment successful', async () => {
    prismaServiceMock.deployment.findFirst.mockResolvedValue(buildProvisionDeployment());
    prismaServiceMock.deployment.update.mockResolvedValue(undefined);
    transactionMock.pulumiStack.upsert.mockResolvedValue(undefined);
    transactionMock.infrastructureResource.deleteMany.mockResolvedValue(undefined);
    transactionMock.infrastructureResource.createMany.mockResolvedValue(undefined);
    transactionMock.deployment.update.mockResolvedValue(undefined);
    pulumiRunnerServiceMock.run.mockImplementation(
      async (options: {
        onLog?: (line: string, level: 'info' | 'warn' | 'error') => void;
        onResourceProgress?: (payload: {
          resourceType: string;
          resourceName: string;
          action: string;
          status: 'started' | 'completed';
        }) => void;
      }) => {
        options.onLog?.('Creating app...', 'info');
        options.onResourceProgress?.({
          resourceType: 'digitalocean:index/app:App',
          resourceName: 'app',
          action: 'create',
          status: 'started',
        });
        return {
          success: true,
          outputs: {
            appId: 'app-123',
            appUrl: {
              value: 'https://my-app.ondigitalocean.app',
            } as unknown as string,
            repositoryUrl: 'registry.digitalocean.com/liftoff/my-app/production',
          },
        };
      },
    );

    await processor.process(
      createJob(JOB_NAMES.INFRASTRUCTURE.PROVISION, {
        deploymentId: 'deploy-1',
        environmentId: 'env-1',
        imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
        configYaml: validConfigYaml,
      }),
    );

    expect(prismaServiceMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: expect.objectContaining({
        status: DeploymentStatus.PROVISIONING,
      }),
    });
    expect(pulumiRunnerServiceMock.run).toHaveBeenCalledWith(
      expect.objectContaining({
        stackName: 'organization/project-1/production',
        doToken: 'dop_v1_real_token',
      }),
    );
    expect(transactionMock.pulumiStack.upsert).toHaveBeenCalled();
    expect(transactionMock.infrastructureResource.createMany).toHaveBeenCalled();
    expect(transactionMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: {
        status: DeploymentStatus.DEPLOYING,
        endpoint: 'https://my-app.ondigitalocean.app',
        errorMessage: null,
      },
    });
    expect(prismaServiceMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: {
        status: DeploymentStatus.SUCCESS,
        endpoint: 'https://my-app.ondigitalocean.app',
        errorMessage: null,
        completedAt: expect.any(Date),
      },
    });
    expect(eventsGatewayMock.broadcastDeploymentComplete).toHaveBeenCalledWith({
      deploymentId: 'deploy-1',
      status: DeploymentStatus.SUCCESS,
      endpoint: 'https://my-app.ondigitalocean.app',
    });
  });

  it('process marks deployment as failed when Pulumi run fails', async () => {
    prismaServiceMock.deployment.findFirst.mockResolvedValue(buildProvisionDeployment());
    prismaServiceMock.deployment.update.mockResolvedValue(undefined);
    pulumiRunnerServiceMock.run.mockResolvedValue({
      success: false,
      outputs: {},
      error: 'Pulumi crashed',
    });

    await expect(
      processor.process(
        createJob(JOB_NAMES.INFRASTRUCTURE.PROVISION, {
          deploymentId: 'deploy-1',
          environmentId: 'env-1',
          imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
          configYaml: validConfigYaml,
        }),
      ),
    ).rejects.toThrow('Pulumi crashed');

    expect(prismaServiceMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: {
        status: DeploymentStatus.FAILED,
        errorMessage: 'Pulumi crashed',
        completedAt: expect.any(Date),
      },
    });
    expect(eventsGatewayMock.broadcastDeploymentComplete).toHaveBeenCalledWith({
      deploymentId: 'deploy-1',
      status: DeploymentStatus.FAILED,
    });
  });

  it('process handles destroy jobs and clears stored stack outputs', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue(buildDestroyEnvironment());
    pulumiRunnerServiceMock.destroy.mockResolvedValue(undefined);
    transactionMock.infrastructureResource.deleteMany.mockResolvedValue(undefined);
    transactionMock.pulumiStack.update.mockResolvedValue(undefined);

    await processor.process(
      createJob(JOB_NAMES.INFRASTRUCTURE.DESTROY, {
        environmentId: 'env-1',
      }),
    );

    expect(pulumiRunnerServiceMock.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        stackName: 'organization/project-1/production',
        doToken: 'dop_v1_real_token',
      }),
    );
    expect(transactionMock.infrastructureResource.deleteMany).toHaveBeenCalledWith({
      where: { environmentId: 'env-1' },
    });
    expect(transactionMock.pulumiStack.update).toHaveBeenCalledWith({
      where: { environmentId: 'env-1' },
      data: {
        outputs: Prisma.JsonNull,
        lastUpdated: expect.any(Date),
      },
    });
  });
});
