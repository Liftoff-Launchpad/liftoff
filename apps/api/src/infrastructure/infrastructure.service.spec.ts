import { Role } from '@prisma/client';
import { Queue } from 'bullmq';
import { EncryptionService } from '../common/services/encryption.service';
import { DoApiService } from '../do-api/do-api.service';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_NAMES } from '../queues/queue.constants';
import { ProjectsService } from '../projects/projects.service';
import { PulumiRunnerService } from './pulumi-runner.service';
import { InfrastructureService } from './infrastructure.service';

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

const buildEnvironmentContext = () => ({
  id: 'env-1',
  doAccountId: 'do-1',
  name: 'production',
  configYaml: validConfigYaml,
  configParsed: null,
  project: {
    id: 'project-1',
    name: 'my-app',
  },
  doAccount: {
    doToken: 'encrypted-token',
    region: 'nyc3',
  },
  deployments: [
    {
      imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
    },
  ],
});

/**
 * Unit tests for InfrastructureService.
 */
describe('InfrastructureService', () => {
  let service: InfrastructureService;

  const prismaServiceMock = {
    environment: {
      findFirst: jest.fn(),
    },
    service: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    infrastructureResource: {
      findMany: jest.fn(),
    },
  };

  const projectsServiceMock = {
    assertProjectRole: jest.fn(),
  };

  const encryptionServiceMock = {
    decrypt: jest.fn((_encrypted: string) => 'dop_v1_real_token'),
  };

  const doApiServiceMock = {
    getOrCreateContainerRegistryName: jest.fn(),
  };

  const pulumiRunnerServiceMock = {
    preview: jest.fn(),
  };

  const infrastructureQueueMock = {
    add: jest.fn(),
  };

  const variablesServiceMock = {
    resolveRuntimeVariablesForService: jest.fn().mockResolvedValue([]),
  };

  const graphCompilerServiceMock = {
    compile: jest.fn().mockResolvedValue({ resources: [], bindings: [], resourceIds: [] }),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new InfrastructureService(
      prismaServiceMock as unknown as PrismaService,
      projectsServiceMock as unknown as ProjectsService,
      encryptionServiceMock as unknown as EncryptionService,
      doApiServiceMock as unknown as DoApiService,
      pulumiRunnerServiceMock as unknown as PulumiRunnerService,
      variablesServiceMock as never,
      graphCompilerServiceMock as never,
      infrastructureQueueMock as unknown as Queue,
    );
  });

  it('previewInfra validates role and invokes Pulumi preview with stack args', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue(buildEnvironmentContext());
    projectsServiceMock.assertProjectRole.mockResolvedValue(Role.OWNER);
    pulumiRunnerServiceMock.preview.mockResolvedValue({
      success: true,
      changeSummary: {
        create: 1,
      },
    });

    const result = await service.previewInfra('env-1', 'user-1');

    expect(result.success).toBe(true);
    expect(projectsServiceMock.assertProjectRole).toHaveBeenCalledWith('project-1', 'user-1', [
      Role.OWNER,
      Role.ADMIN,
    ]);
    expect(encryptionServiceMock.decrypt).toHaveBeenCalledWith('encrypted-token');
    expect(pulumiRunnerServiceMock.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        stackName: 'organization/project-1/production',
        doToken: 'dop_v1_real_token',
      }),
    );
  });

  it('destroyInfra enqueues the infrastructure destroy job after role check', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue(buildEnvironmentContext());
    projectsServiceMock.assertProjectRole.mockResolvedValue(Role.ADMIN);
    infrastructureQueueMock.add.mockResolvedValue(undefined);

    await service.destroyInfra('env-1', 'user-1');

    expect(infrastructureQueueMock.add).toHaveBeenCalledWith(
      JOB_NAMES.INFRASTRUCTURE.DESTROY,
      { environmentId: 'env-1' },
      { attempts: 1 },
    );
  });

  it('getResources verifies access and returns persisted resources', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue(buildEnvironmentContext());
    projectsServiceMock.assertProjectRole.mockResolvedValue(Role.DEVELOPER);
    prismaServiceMock.infrastructureResource.findMany.mockResolvedValue([
      {
        id: 'resource-1',
      },
    ]);

    const result = await service.getResources('env-1', 'user-1');

    expect(projectsServiceMock.assertProjectRole).toHaveBeenCalledWith('project-1', 'user-1');
    expect(prismaServiceMock.infrastructureResource.findMany).toHaveBeenCalledWith({
      where: { environmentId: 'env-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(result).toEqual([{ id: 'resource-1' }]);
  });
});
