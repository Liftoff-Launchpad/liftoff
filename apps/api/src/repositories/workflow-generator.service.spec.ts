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

  it('generates a single-service matrix workflow with deploy callback', async () => {
    const workflow = await service.generate({
      projectName: 'my-app',
      environmentId: 'env-1',
      branch: 'main',
      liftoffApiUrl: 'https://liftoff.example.com/',
      services: [
        {
          name: 'web',
          context: './apps/web',
          dockerfilePath: './deploy/Dockerfile',
          buildStrategy: 'auto',
          imageRepository: 'my-app/production',
        },
      ],
      doToken: 'dop_v1_token',
      doAccountId: 'do-account-1',
    });

    expect(doApiServiceMock.getOrCreateContainerRegistryName).toHaveBeenCalledWith(
      'dop_v1_token',
      'do-account-1',
    );
    expect(workflow).toContain("branches: ['main']");
    expect(workflow).toContain('digitalocean/action-doctl@v2');
    expect(workflow).toContain('strategy:');
    expect(workflow).toContain('matrix:');
    expect(workflow).toContain('- name: "web"');
    expect(workflow).toContain('context: "./apps/web"');
    expect(workflow).toContain('dockerfilePath: "./deploy/Dockerfile"');
    expect(workflow).toContain('buildStrategy: "auto"');
    expect(workflow).toContain('imageRepository: "my-app/production"');
    expect(workflow).toContain(
      'IMAGE_URI: registry.digitalocean.com/user-registry/${{ matrix.service.imageRepository }}:${{ github.sha }}',
    );
    expect(workflow).toContain('SERVICE_NAME: ${{ matrix.service.name }}');
    expect(workflow).toContain('https://liftoff.example.com/api/v1/webhooks/deploy-complete');
    expect(workflow).toContain('secrets.LIFTOFF_DEPLOY_SECRET');
    expect(workflow).toContain('\\"serviceName\\":\\"$SERVICE_NAME\\"');
    // No BUILD vars passed → no LIFTOFF_BUILD_* env mappings
    expect(workflow).not.toContain('secrets.LIFTOFF_BUILD_');
  });

  it('emits one matrix entry per service for multi-service envs', async () => {
    const workflow = await service.generate({
      projectName: 'monorepo',
      environmentId: 'env-1',
      branch: 'main',
      liftoffApiUrl: 'https://liftoff.example.com',
      services: [
        {
          name: 'web',
          context: './web',
          dockerfilePath: 'Dockerfile',
          buildStrategy: 'auto',
          imageRepository: 'monorepo/production/web',
        },
        {
          name: 'api',
          context: './api',
          dockerfilePath: 'Dockerfile',
          buildStrategy: 'dockerfile',
          imageRepository: 'monorepo/production/api',
        },
      ],
      doToken: 'dop_v1_token',
    });

    expect(workflow).toContain('- name: "web"');
    expect(workflow).toContain('- name: "api"');
    expect(workflow).toContain('imageRepository: "monorepo/production/web"');
    expect(workflow).toContain('imageRepository: "monorepo/production/api"');
  });

  it('exposes BUILD-scope variable keys as Actions secret env mappings + build args', async () => {
    const workflow = await service.generate({
      projectName: 'my-app',
      environmentId: 'env-1',
      branch: 'main',
      liftoffApiUrl: 'https://liftoff.example.com',
      services: [
        {
          name: 'web',
          context: '.',
          dockerfilePath: 'Dockerfile',
          buildStrategy: 'auto',
          imageRepository: 'my-app/production',
        },
      ],
      buildVariableKeys: ['NEXT_PUBLIC_API_URL', 'STRIPE_PK'],
      doToken: 'dop_v1_token',
    });

    expect(workflow).toContain('NEXT_PUBLIC_API_URL: ${{ secrets.LIFTOFF_BUILD_NEXT_PUBLIC_API_URL }}');
    expect(workflow).toContain('STRIPE_PK: ${{ secrets.LIFTOFF_BUILD_STRIPE_PK }}');
    expect(workflow).toContain('DOCKER_BUILD_ARGS=""');
    expect(workflow).toContain('NIXPACKS_ENV_ARGS=""');
    expect(workflow).toContain('--build-arg NEXT_PUBLIC_API_URL');
    expect(workflow).toContain('--build-arg STRIPE_PK');
    expect(workflow).toContain('--env NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}');
  });
});
