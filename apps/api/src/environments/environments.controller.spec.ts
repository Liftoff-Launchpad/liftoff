import type { User } from '@prisma/client';
import { ConfigYamlDto } from './dto/config-yaml.dto';
import { EnvironmentsController } from './environments.controller';
import { EnvironmentsService } from './environments.service';

const now = new Date('2025-01-01T00:00:00.000Z');

const buildUser = (): User => ({
  id: 'user-1',
  email: 'dev@liftoff.dev',
  githubId: '123',
  githubUsername: 'liftoffdev',
  githubToken: null,
  name: 'Liftoff Dev',
  avatarUrl: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

/**
 * Unit tests for EnvironmentsController.
 */
describe('EnvironmentsController', () => {
  let controller: EnvironmentsController;

  const environmentsServiceMock = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateConfig: jest.fn(),
    validateConfig: jest.fn(),
  };

  const variablesServiceMock = {
    applyVariables: jest.fn().mockResolvedValue({ bundleId: 'bundle-1', deploymentCount: 1 }),
  };

  const repositoriesServiceMock = {
    triggerBuildForEnvironment: jest.fn().mockResolvedValue({
      workflowFile: 'liftoff-deploy.yml',
      ref: 'main',
      repository: 'org/repo',
      bundleId: 'bundle-1',
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new EnvironmentsController(
      environmentsServiceMock as unknown as EnvironmentsService,
      variablesServiceMock as never,
      repositoriesServiceMock as never,
    );
  });

  it('updateConfig delegates config yaml payload with route ids and user id', async () => {
    const dto: ConfigYamlDto = { configYaml: 'version: "1.0"' };
    environmentsServiceMock.updateConfig.mockResolvedValue({
      id: 'env-1',
    });

    await controller.updateConfig('project-1', 'env-1', buildUser(), dto);

    expect(environmentsServiceMock.updateConfig).toHaveBeenCalledWith(
      'project-1',
      'env-1',
      'user-1',
      'version: "1.0"',
    );
  });

  it('validateConfig delegates full DTO for dry-run validation', async () => {
    const dto: ConfigYamlDto = { configYaml: 'version: "1.0"' };
    environmentsServiceMock.validateConfig.mockResolvedValue({ valid: true });

    await controller.validateConfig('project-1', 'env-1', buildUser(), dto);

    expect(environmentsServiceMock.validateConfig).toHaveBeenCalledWith(
      'project-1',
      'env-1',
      'user-1',
      dto,
    );
  });
});
