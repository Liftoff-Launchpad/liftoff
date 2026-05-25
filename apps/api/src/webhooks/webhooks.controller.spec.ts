import { DeployCompleteDto } from './dto/deploy-complete.dto';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Unit tests for WebhooksController.
 */
describe('WebhooksController', () => {
  let controller: WebhooksController;

  const webhooksServiceMock = {
    handleGitHubPush: jest.fn(),
    handleDeployComplete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WebhooksController(webhooksServiceMock as unknown as WebhooksService);
  });

  it('handleGitHubWebhook parses payload and delegates raw body + signature', async () => {
    webhooksServiceMock.handleGitHubPush.mockResolvedValue(undefined);
    const rawBody = Buffer.from(
      JSON.stringify({
        ref: 'refs/heads/main',
        repository: { full_name: 'liftoff/my-app' },
      }),
      'utf8',
    );

    await controller.handleGitHubWebhook('sha256=signature', {
      rawBody,
      body: rawBody,
    });

    expect(webhooksServiceMock.handleGitHubPush).toHaveBeenCalledWith(
      {
        ref: 'refs/heads/main',
        repository: { full_name: 'liftoff/my-app' },
      },
      'sha256=signature',
      rawBody,
    );
  });

  it('handleDeployComplete delegates DTO payload and secret header', async () => {
    webhooksServiceMock.handleDeployComplete.mockResolvedValue(undefined);
    const dto = {
      environmentId: 'env-1',
      imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
      commitSha: 'abc123',
      buildStrategy: 'nixpacks',
      buildPlan: '{"provider":"nixpacks","phases":["setup","build"]}',
    } as DeployCompleteDto & {
      buildStrategy: string;
      buildPlan: string;
    };

    await controller.handleDeployComplete('deploy-secret', dto);

    expect(webhooksServiceMock.handleDeployComplete).toHaveBeenCalledWith(
      {
        environmentId: 'env-1',
        imageUri: 'registry.digitalocean.com/liftoff/my-app/production:abc123',
        commitSha: 'abc123',
        buildStrategy: 'nixpacks',
        buildPlan: '{"provider":"nixpacks","phases":["setup","build"]}',
      },
      'deploy-secret',
    );
  });
});
