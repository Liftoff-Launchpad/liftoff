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
});
