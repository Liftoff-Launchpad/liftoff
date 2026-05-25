import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ErrorCodes } from '@liftoff/shared';
import { Public } from '../common/decorators';
import { Exceptions } from '../common/exceptions/app.exception';
import { DeployCompleteDto } from './dto/deploy-complete.dto';
import {
  DeployCompletePayload,
  GitHubPushPayload,
  WebhooksService,
} from './webhooks.service';

type RawWebhookRequest = {
  rawBody?: Buffer;
  body?: Buffer | string | object;
};

/**
 * Public webhook endpoints for GitHub push events and workflow callbacks.
 */
@Controller('webhooks')
@ApiTags('Webhooks')
export class WebhooksController {
  public constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Handles GitHub push webhooks using raw payload for HMAC verification.
   */
  @Public()
  @Post('github')
  @HttpCode(HttpStatus.OK)
  public async handleGitHubWebhook(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() request: RawWebhookRequest,
  ): Promise<{ received: true }> {
    const rawBody = this.resolveRawBody(request);
    const payload = this.parseGitHubPayload(rawBody);

    await this.webhooksService.handleGitHubPush(payload, signature, rawBody);

    return { received: true };
  }

  /**
   * Handles deploy completion callback sent from the generated GitHub workflow.
   */
  @Public()
  @Post('deploy-complete')
  @HttpCode(HttpStatus.OK)
  public async handleDeployComplete(
    @Headers('x-liftoff-secret') secretHeader: string | undefined,
    @Body() dto: DeployCompleteDto,
  ): Promise<{ received: true }> {
    const payload: DeployCompletePayload = {
      environmentId: dto.environmentId,
      imageUri: dto.imageUri,
      commitSha: dto.commitSha,
      status: dto.status,
      runUrl: dto.runUrl,
      buildStrategy: dto.buildStrategy,
      buildPlan: dto.buildPlan,
    };

    await this.webhooksService.handleDeployComplete(payload, secretHeader);
    return { received: true };
  }

  private resolveRawBody(request: RawWebhookRequest): Buffer {
    if (Buffer.isBuffer(request.rawBody)) {
      return request.rawBody;
    }

    const body = request.body;
    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (typeof body === 'string') {
      return Buffer.from(body, 'utf8');
    }

    if (body && typeof body === 'object') {
      return Buffer.from(JSON.stringify(body), 'utf8');
    }

    throw Exceptions.badRequest('Webhook payload body is missing', ErrorCodes.VALIDATION_ERROR);
  }

  private parseGitHubPayload(rawBody: Buffer): GitHubPushPayload {
    try {
      const parsedPayload = JSON.parse(rawBody.toString('utf8')) as GitHubPushPayload;
      return parsedPayload;
    } catch {
      throw Exceptions.badRequest('Invalid GitHub webhook payload', ErrorCodes.VALIDATION_ERROR);
    }
  }
}
