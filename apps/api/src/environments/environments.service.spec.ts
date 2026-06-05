import { Role, ServiceType } from '@prisma/client';
import {
  DIGITALOCEAN_ACCESS_TOKEN_SECRET_NAME,
  resolveEnvironmentDeploySecretName,
  safeParseLiftoffConfig,
} from '@liftoff/shared';
import * as yaml from 'js-yaml';
import { EncryptionService } from '../common/services/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { GitHubService } from '../repositories/github.service';
import { ConfigYamlDto } from './dto/config-yaml.dto';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { EnvironmentsService } from './environments.service';

const now = new Date('2025-01-01T00:00:00.000Z');

const buildEnvironmentRecord = () => ({
  id: 'env-1',
  projectId: 'project-1',
  doAccountId: 'do-1',
  name: 'production',
  gitBranch: 'main',
  liftoffDeploySecret: null,
  serviceType: ServiceType.APP,
  configYaml: null,
  configParsed: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

/**
 * Unit tests for EnvironmentsService.
 */
describe('EnvironmentsService', () => {
  let service: EnvironmentsService;

  const prismaServiceMock = {
    environment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    dOAccount: {
      findFirst: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    repository: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const projectsServiceMock = {
    assertProjectRole: jest.fn(),
  };

  const encryptionServiceMock = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn(() => 'decrypted-github-token'),
  };

  const githubServiceMock = {
    upsertActionsSecret: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EnvironmentsService(
      prismaServiceMock as unknown as PrismaService,
      projectsServiceMock as unknown as ProjectsService,
      encryptionServiceMock as unknown as EncryptionService,
      githubServiceMock as unknown as GitHubService,
    );
  });

  it('create verifies access and DO account ownership before insert', async () => {
    const dto: CreateEnvironmentDto = {
      name: 'production',
      gitBranch: 'main',
      doAccountId: 'do-1',
      serviceType: 'APP',
    };
    projectsServiceMock.assertProjectRole.mockResolvedValue(Role.OWNER);
    prismaServiceMock.dOAccount.findFirst.mockResolvedValue({
      id: 'do-1',
      doToken: 'encrypted-do-token',
    });
    prismaServiceMock.project.findFirst.mockResolvedValue({
      repositories: [],
      user: {
        githubToken: null,
      },
    });
    prismaServiceMock.environment.create.mockImplementation(async (input) => ({
      ...buildEnvironmentRecord(),
      ...input.data,
    }));

    const result = await service.create('project-1', 'user-1', dto);
    const createInput = prismaServiceMock.environment.create.mock.calls[0]?.[0];
    const encryptionInput = encryptionServiceMock.encrypt.mock.calls[0]?.[0];
    const persistedSecret = createInput?.data?.liftoffDeploySecret;
    const persistedConfigYaml = createInput?.data?.configYaml;
    const persistedConfigParsed = createInput?.data?.configParsed;
    const parsedYaml = safeParseLiftoffConfig(yaml.load(String(persistedConfigYaml)));
    const expectedDefaultConfigYaml = [
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

    expect(result.id).toBe('env-1');
    expect(encryptionInput).toEqual(expect.stringMatching(/^[0-9a-f]{20}$/));
    expect(persistedSecret).toBe(`encrypted:${encryptionInput}`);
    expect(result.liftoffDeploySecret).toBe(persistedSecret);
    expect(persistedConfigYaml).toBe(expectedDefaultConfigYaml);
    expect(parsedYaml.success).toBe(true);
    expect(persistedConfigParsed).toEqual(
      expect.objectContaining({
        version: '1.0',
        service: expect.objectContaining({
          name: 'test-app',
          type: 'app',
          region: 'nyc3',
        }),
        runtime: expect.objectContaining({
          port: 3000,
        }),
      }),
    );
    expect(projectsServiceMock.assertProjectRole).toHaveBeenCalledWith('project-1', 'user-1', [
      Role.OWNER,
      Role.ADMIN,
    ]);
    expect(prismaServiceMock.environment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'project-1',
          doAccountId: 'do-1',
          name: 'production',
          gitBranch: 'main',
          liftoffDeploySecret: expect.stringMatching(/^encrypted:[0-9a-f]{20}$/),
          serviceType: ServiceType.APP,
          configYaml: expect.any(String),
          configParsed: expect.objectContaining({
            version: '1.0',
          }),
          // The create now also seeds a default Service row (multi-service Phase 1).
          services: expect.anything(),
        }),
      }),
    );
    expect(githubServiceMock.upsertActionsSecret).not.toHaveBeenCalled();
  });

  it('create syncs a new environment secret to GitHub when a repository is connected', async () => {
    const dto: CreateEnvironmentDto = {
      name: 'production',
      gitBranch: 'main',
      doAccountId: 'do-1',
      serviceType: 'APP',
    };
    projectsServiceMock.assertProjectRole.mockResolvedValue(Role.OWNER);
    prismaServiceMock.dOAccount.findFirst.mockResolvedValue({
      id: 'do-1',
      doToken: 'encrypted-do-token',
    });
    prismaServiceMock.project.findFirst.mockResolvedValue({
      repositories: [{ fullName: 'liftoff/my-app' }],
      user: {
        githubToken: 'encrypted-github-token',
      },
    });
    prismaServiceMock.environment.create.mockImplementation(async (input) => ({
      ...buildEnvironmentRecord(),
      ...input.data,
    }));
    githubServiceMock.upsertActionsSecret.mockResolvedValue(undefined);

    await service.create('project-1', 'user-1', dto);

    const generatedSecret = encryptionServiceMock.encrypt.mock.calls[0]?.[0];
    expect(githubServiceMock.upsertActionsSecret).toHaveBeenNthCalledWith(
      1,
      'decrypted-github-token',
      'liftoff/my-app',
      resolveEnvironmentDeploySecretName('env-1'),
      generatedSecret,
    );
    expect(githubServiceMock.upsertActionsSecret).toHaveBeenNthCalledWith(
      2,
      'decrypted-github-token',
      'liftoff/my-app',
      DIGITALOCEAN_ACCESS_TOKEN_SECRET_NAME,
      'decrypted-github-token',
    );
  });

  it('create rolls back environment creation if GitHub secret sync fails', async () => {
    const dto: CreateEnvironmentDto = {
      name: 'production',
      gitBranch: 'main',
      doAccountId: 'do-1',
      serviceType: 'APP',
    };
    projectsServiceMock.assertProjectRole.mockResolvedValue(Role.OWNER);
    prismaServiceMock.dOAccount.findFirst.mockResolvedValue({
      id: 'do-1',
      doToken: 'encrypted-do-token',
    });
    prismaServiceMock.project.findFirst.mockResolvedValue({
      repositories: [{ fullName: 'liftoff/my-app' }],
      user: {
        githubToken: 'encrypted-github-token',
      },
    });
    prismaServiceMock.environment.create.mockImplementation(async (input) => ({
      ...buildEnvironmentRecord(),
      ...input.data,
    }));
    githubServiceMock.upsertActionsSecret.mockRejectedValue({
      response: {
        status: 403,
        data: {
          message: 'Resource not accessible by integration',
        },
      },
    });
    prismaServiceMock.environment.delete.mockResolvedValue(undefined);

    await expect(service.create('project-1', 'user-1', dto)).rejects.toThrow(
      'GitHub token is missing Actions secret permissions',
    );
    expect(prismaServiceMock.environment.delete).toHaveBeenCalledWith({
      where: {
        id: 'env-1',
      },
    });
  });

  it('validateConfig returns structured errors for invalid YAML', async () => {
    const dto: ConfigYamlDto = {
      configYaml: 'version: "1.0"\nservice: [invalid',
    };
    projectsServiceMock.assertProjectRole.mockResolvedValue(Role.ADMIN);
    prismaServiceMock.environment.findFirst.mockResolvedValue(buildEnvironmentRecord());

    const result = await service.validateConfig('project-1', 'env-1', 'user-1', dto);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toEqual({
      path: 'root',
      code: 'invalid_yaml',
      message: 'Invalid YAML syntax',
    });
  });

  it('updateConfig throws on schema validation failure', async () => {
    const invalidConfigYaml =
      'version: "1.0"\nservice:\n  name: test\n  type: app\n  region: nyc3\nruntime:\n  replicas: 2\nhealthcheck:\n  path: /health';
    projectsServiceMock.assertProjectRole.mockResolvedValue(Role.OWNER);
    prismaServiceMock.environment.findFirst.mockResolvedValue(buildEnvironmentRecord());

    await expect(
      service.updateConfig('project-1', 'env-1', 'user-1', invalidConfigYaml),
    ).rejects.toThrow('liftoff.yml validation failed');
  });
});
