import type { User } from '@prisma/client';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { InfrastructureService } from './infrastructure.service';
import { PulumiPreviewResult } from './types/pulumi.types';

/**
 * Environment infrastructure preview, destroy, and resource listing endpoints.
 */
@Controller('environments/:environmentId/infrastructure')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Infrastructure')
export class InfrastructureController {
  public constructor(private readonly infrastructureService: InfrastructureService) {}

  /**
   * Previews Pulumi changes for the specified environment stack.
   */
  @Post('preview')
  public previewInfra(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<PulumiPreviewResult> {
    return this.infrastructureService.previewInfra(environmentId, user.id);
  }

  /**
   * Applies the interactive graph — provisions managed resources and redeploys
   * services with connection env vars injected. Reuses existing images (no
   * rebuild). This is the canvas "Deploy" action.
   */
  @Post('apply')
  public applyGraph(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<{ bundleId: string; deploymentCount: number }> {
    return this.infrastructureService.applyGraph(environmentId, user.id);
  }

  /**
   * Queues infrastructure destroy for the specified environment stack.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  public async destroyInfra(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.infrastructureService.destroyInfra(environmentId, user.id);
  }

  /**
   * Lists tracked infrastructure resources for the environment.
   */
  @Get('resources')
  public getResources(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ) {
    return this.infrastructureService.getResources(environmentId, user.id);
  }
}
