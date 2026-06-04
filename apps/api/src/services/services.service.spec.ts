import { ServicesService } from './services.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesService } from '../repositories/repositories.service';

/**
 * Unit tests for the scaling path (Phase E). A pure instanceSize/replicas change
 * persists to the Service row but must NOT regenerate the GitHub workflow — only
 * build-affecting fields do. Scaling lands via Pulumi on the next deploy.
 */
describe('ServicesService.update (scaling)', () => {
  let service: ServicesService;

  const prismaServiceMock = {
    service: {
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    environment: {
      findFirst: jest.fn(),
    },
    repository: {
      findFirst: jest.fn(),
    },
  };
  const projectsServiceMock = { assertProjectRole: jest.fn() };
  const repositoriesServiceMock = { syncWorkflowForEnvironment: jest.fn() };

  const existingService = {
    id: 'svc-1',
    environmentId: 'env-1',
    name: 'api',
    environment: { projectId: 'proj-1' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ServicesService(
      prismaServiceMock as unknown as PrismaService,
      projectsServiceMock as unknown as ProjectsService,
      repositoriesServiceMock as unknown as RepositoriesService,
    );
    projectsServiceMock.assertProjectRole.mockResolvedValue(undefined);
    prismaServiceMock.service.findFirst.mockResolvedValue(existingService);
    prismaServiceMock.service.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'svc-1', environmentId: 'env-1', name: 'api', ...data }),
    );
  });

  it('persists instanceSize/replicas and does not regenerate the workflow', async () => {
    const updated = await service.update('svc-1', 'user-1', {
      instanceSize: 'apps-s-1vcpu-1gb',
      replicas: 2,
    });

    expect(prismaServiceMock.service.update).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: { instanceSize: 'apps-s-1vcpu-1gb', replicas: 2 },
    });
    expect(updated.replicas).toBe(2);
    expect(repositoriesServiceMock.syncWorkflowForEnvironment).not.toHaveBeenCalled();
  });

  it('regenerates the workflow when a build-affecting field changes', async () => {
    repositoriesServiceMock.syncWorkflowForEnvironment.mockResolvedValue(undefined);

    await service.update('svc-1', 'user-1', { sourceDir: './api' });

    expect(repositoriesServiceMock.syncWorkflowForEnvironment).toHaveBeenCalledWith('env-1', 'user-1');
  });

  it('re-points a service to another repo and regenerates the workflow', async () => {
    prismaServiceMock.repository.findFirst.mockResolvedValue({ id: 'repo-2' });
    repositoriesServiceMock.syncWorkflowForEnvironment.mockResolvedValue(undefined);

    await service.update('svc-1', 'user-1', { repositoryId: 'repo-2' });

    expect(prismaServiceMock.service.update).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: { repository: { connect: { id: 'repo-2' } } },
    });
    expect(repositoriesServiceMock.syncWorkflowForEnvironment).toHaveBeenCalledWith('env-1', 'user-1');
  });

  it('rejects a repositoryId that does not belong to the project', async () => {
    prismaServiceMock.repository.findFirst.mockResolvedValue(null);

    await expect(service.update('svc-1', 'user-1', { repositoryId: 'repo-x' })).rejects.toThrow(
      /not a repository connected to this project/,
    );
    expect(prismaServiceMock.service.update).not.toHaveBeenCalled();
  });
});

describe('ServicesService.create (repo assignment)', () => {
  let service: ServicesService;

  const prismaServiceMock = {
    service: {
      count: jest.fn(),
      create: jest.fn(),
    },
    environment: {
      findFirst: jest.fn(),
    },
  };
  const projectsServiceMock = { assertProjectRole: jest.fn() };
  const repositoriesServiceMock = { syncWorkflowForEnvironment: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ServicesService(
      prismaServiceMock as unknown as PrismaService,
      projectsServiceMock as unknown as ProjectsService,
      repositoriesServiceMock as unknown as RepositoriesService,
    );
    projectsServiceMock.assertProjectRole.mockResolvedValue(undefined);
    repositoriesServiceMock.syncWorkflowForEnvironment.mockResolvedValue(undefined);
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      projectId: 'proj-1',
      project: { repositories: [{ id: 'repo-1' }, { id: 'repo-2' }] },
    });
    prismaServiceMock.service.count.mockResolvedValue(1);
    prismaServiceMock.service.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'svc-new', ...data }),
    );
  });

  it('binds a new service to the requested repo', async () => {
    const created = await service.create('env-1', 'user-1', { name: 'api', repositoryId: 'repo-2' });

    expect(created.repositoryId).toBe('repo-2');
    expect(prismaServiceMock.service.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ repositoryId: 'repo-2' }) }),
    );
  });

  it('defaults a new service to the primary (oldest) repo', async () => {
    await service.create('env-1', 'user-1', { name: 'api' });

    expect(prismaServiceMock.service.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ repositoryId: 'repo-1' }) }),
    );
  });

  it('rejects a repositoryId not connected to the project', async () => {
    await expect(
      service.create('env-1', 'user-1', { name: 'api', repositoryId: 'repo-x' }),
    ).rejects.toThrow(/not a repository connected to this project/);
    expect(prismaServiceMock.service.create).not.toHaveBeenCalled();
  });
});
