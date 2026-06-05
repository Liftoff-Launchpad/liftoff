import { ConnectionsService } from './connections.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

/**
 * Unit tests for the connection preview (Phase B) — names the env vars an edge
 * injects without mutating, resolved via the shared binding templates.
 */
describe('ConnectionsService.preview', () => {
  let service: ConnectionsService;

  const prismaServiceMock = {
    connection: { findFirst: jest.fn() },
    service: { findUnique: jest.fn(), findFirst: jest.fn() },
    resource: { findFirst: jest.fn() },
  };
  const projectsServiceMock = { assertProjectRole: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConnectionsService(
      prismaServiceMock as unknown as PrismaService,
      projectsServiceMock as unknown as ProjectsService,
    );
    projectsServiceMock.assertProjectRole.mockResolvedValue(undefined);
  });

  it('previews a Postgres binding as DATABASE_URL (secret)', async () => {
    prismaServiceMock.connection.findFirst.mockResolvedValue({
      id: 'conn-1',
      kind: 'RESOURCE_BINDING',
      sourceResourceId: 'res-1',
      sourceServiceId: null,
      targetServiceId: 'svc-1',
      injectConfig: null,
      environment: { projectId: 'proj-1' },
    });
    prismaServiceMock.service.findUnique.mockResolvedValue({ name: 'api' });
    prismaServiceMock.resource.findFirst.mockResolvedValue({ name: 'main-db', kind: 'POSTGRES' });

    const preview = await service.preview('conn-1', 'user-1');

    expect(preview.targetService).toBe('api');
    expect(preview.source).toBe('main-db');
    expect(preview.injectedVars).toContain('DATABASE_URL');
    expect(preview.secretVars).toContain('DATABASE_URL');
    expect(projectsServiceMock.assertProjectRole).toHaveBeenCalledWith('proj-1', 'user-1');
  });

  it('previews a service link as INTERNAL_<NAME>_URL', async () => {
    prismaServiceMock.connection.findFirst.mockResolvedValue({
      id: 'conn-2',
      kind: 'SERVICE_LINK',
      sourceResourceId: null,
      sourceServiceId: 'svc-2',
      targetServiceId: 'svc-1',
      injectConfig: null,
      environment: { projectId: 'proj-1' },
    });
    prismaServiceMock.service.findUnique.mockResolvedValue({ name: 'web' });
    prismaServiceMock.service.findFirst.mockResolvedValue({ name: 'api' });

    const preview = await service.preview('conn-2', 'user-1');

    expect(preview.targetService).toBe('web');
    expect(preview.injectedVars).toEqual(['INTERNAL_API_URL']);
    expect(preview.secretVars).toEqual([]);
  });
});
