import { MonitoringService } from './monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { DoApiService } from '../do-api/do-api.service';
import { EncryptionService } from '../common/services/encryption.service';

/**
 * Unit tests for the service-scoped metrics path (Phase E). Verify the metric
 * type maps to DO's metric name and the App Platform component name is resolved
 * from the env's name (so per-service metrics scope to the right component).
 */
describe('MonitoringService.getMetrics', () => {
  let service: MonitoringService;

  const prismaServiceMock = {
    environment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const projectsServiceMock = { assertProjectRole: jest.fn() };
  const doApiServiceMock = { getAppMetrics: jest.fn() };
  const encryptionServiceMock = { decrypt: jest.fn() };

  const provisionedEnv = {
    id: 'env-1',
    projectId: 'proj-1',
    doAccountId: 'do-1',
    doAccount: { doToken: 'encrypted' },
    pulumiStack: { outputs: { appId: 'app-123', appUrl: 'https://app.example' } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonitoringService(
      prismaServiceMock as unknown as PrismaService,
      projectsServiceMock as unknown as ProjectsService,
      doApiServiceMock as unknown as DoApiService,
      encryptionServiceMock as unknown as EncryptionService,
    );
    projectsServiceMock.assertProjectRole.mockResolvedValue(undefined);
    encryptionServiceMock.decrypt.mockReturnValue('dop_v1_token');
    doApiServiceMock.getAppMetrics.mockResolvedValue([{ timestamp: 1, value: 2 }]);
  });

  it('maps restart → restart_count and scopes to the <service>-<env> component', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue(provisionedEnv);
    prismaServiceMock.environment.findUnique.mockResolvedValue({ name: 'prod' });

    const result = await service.getMetrics('env-1', 'user-1', 'restart', 'api', 6);

    expect(result).toEqual([{ timestamp: 1, value: 2 }]);
    expect(doApiServiceMock.getAppMetrics).toHaveBeenCalledTimes(1);
    const callArgs = doApiServiceMock.getAppMetrics.mock.calls[0];
    expect(callArgs[0]).toBe('dop_v1_token'); // decrypted token
    expect(callArgs[1]).toBe('app-123'); // appId
    expect(callArgs[2]).toBe('restart_count'); // mapped metric type
    expect(callArgs[4]).toBe('api-prod'); // resolved component name
  });

  it('returns [] without calling DO when the env has no Pulumi stack yet', async () => {
    prismaServiceMock.environment.findFirst.mockResolvedValue({
      ...provisionedEnv,
      pulumiStack: null,
    });

    const result = await service.getMetrics('env-1', 'user-1', 'cpu');

    expect(result).toEqual([]);
    expect(doApiServiceMock.getAppMetrics).not.toHaveBeenCalled();
  });
});
