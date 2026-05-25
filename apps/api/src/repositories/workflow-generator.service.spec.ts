import { DoApiService } from '../do-api/do-api.service';
import { WorkflowGeneratorService } from './workflow-generator.service';

/**
 * Unit tests for WorkflowGeneratorService.
 */
describe('WorkflowGeneratorService', () => {
  let service: WorkflowGeneratorService;
  const doApiServiceMock = {
    getOrCreateContainerRegistryName: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    doApiServiceMock.getOrCreateContainerRegistryName.mockResolvedValue('user-registry');
    service = new WorkflowGeneratorService(doApiServiceMock as unknown as DoApiService);
  });

  it('generates a DigitalOcean workflow with deploy callback', async () => {
    const workflow = await service.generate({
      projectName: 'my-app',
      environmentId: 'env-1',
      branch: 'main',
      imageRepository: 'my-app/production',
      liftoffApiUrl: 'https://liftoff.example.com/',
      buildStrategy: 'auto',
      dockerfilePath: './deploy/Dockerfile',
      dockerBuildContext: './apps/web',
      doToken: 'dop_v1_token',
      doAccountId: 'do-account-1',
    });

    expect(doApiServiceMock.getOrCreateContainerRegistryName).toHaveBeenCalledWith(
      'dop_v1_token',
      'do-account-1',
    );
    expect(workflow).toContain("branches: ['main']");
    expect(workflow).toContain('digitalocean/action-doctl@v2');
    expect(workflow).toContain('IMAGE_URI: registry.digitalocean.com/user-registry/my-app/production:${{ github.sha }}');
    expect(workflow).toContain('CONFIGURED_BUILD_STRATEGY: auto');
    expect(workflow).toContain('CONFIGURED_DOCKERFILE_PATH: ./deploy/Dockerfile');
    expect(workflow).toContain('CONFIGURED_DOCKER_CONTEXT: ./apps/web');
    expect(workflow).toContain('if [ -f "./Dockerfile" ]');
    expect(workflow).toContain('nixpacks build "$CONFIGURED_DOCKER_CONTEXT" --name "$IMAGE_URI"');
    expect(workflow).toContain('buildStrategy');
    expect(workflow).toContain('buildPlan');
    expect(workflow).toContain('https://liftoff.example.com/api/v1/webhooks/deploy-complete');
    expect(workflow).toContain('secrets.LIFTOFF_DEPLOY_SECRET');
  });
});
