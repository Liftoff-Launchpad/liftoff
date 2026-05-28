import type { User } from '@prisma/client';
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaginationQuery } from '@liftoff/shared';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DeploymentsListResponse, DeploymentsService } from './deployments.service';
import { ListDeploymentsQueryDto } from './dto/list-deployments-query.dto';
import { TriggerDeploymentDto } from './dto/trigger-deployment.dto';

/**
 * Environment-scoped deployment endpoints.
 */
@Controller('environments/:environmentId/deployments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Deployments')
export class DeploymentsController {
  public constructor(private readonly deploymentsService: DeploymentsService) {}

  /**
   * Lists deployments for an environment.
   */
  @Get()
  public findAll(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
    @Query() query: ListDeploymentsQueryDto,
  ): Promise<DeploymentsListResponse> {
    const paginationQuery: PaginationQuery = {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };

    return this.deploymentsService.findAll(environmentId, user.id, paginationQuery);
  }

  /**
   * Returns one deployment by ID.
   */
  @Get(':id')
  public findOne(
    @Param('environmentId') environmentId: string,
    @Param('id') deploymentId: string,
    @CurrentUser() user: User,
  ) {
    return this.deploymentsService.findOne(environmentId, deploymentId, user.id);
  }

  /**
   * Returns persisted logs for a deployment.
   */
  @Get(':id/logs')
  public getDeploymentLogs(
    @Param('environmentId') environmentId: string,
    @Param('id') deploymentId: string,
    @CurrentUser() user: User,
  ) {
    return this.deploymentsService.getDeploymentLogs(environmentId, deploymentId, user.id);
  }

  /**
   * Returns the most recent deployment for a service plus its persisted logs
   * (build + pulumi). Drives the "Last build output" panel in the canvas drawer
   * so failed builds show their actual error without the user leaving for the
   * GitHub Actions tab. Returns `null` when the service has never been deployed.
   */
  @Get('latest-by-service/:serviceName')
  public getLatestForService(
    @Param('environmentId') environmentId: string,
    @Param('serviceName') serviceName: string,
    @CurrentUser() user: User,
  ) {
    return this.deploymentsService.getLatestServiceDeployment(environmentId, serviceName, user.id);
  }

  /**
   * Triggers a deployment for an environment.
   */
  @Post()
  public trigger(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
    @Body() dto: TriggerDeploymentDto,
  ) {
    return this.deploymentsService.trigger(environmentId, user.id, dto);
  }

  /**
   * Queues rollback to the target deployment ID.
   */
  @Post(':id/rollback')
  public rollback(
    @Param('environmentId') environmentId: string,
    @Param('id') targetDeploymentId: string,
    @CurrentUser() user: User,
  ) {
    return this.deploymentsService.rollback(targetDeploymentId, user.id, environmentId);
  }

  /**
   * Cancels a pending or queued deployment.
   */
  @Post(':id/cancel')
  public cancel(
    @Param('environmentId') environmentId: string,
    @Param('id') deploymentId: string,
    @CurrentUser() user: User,
  ) {
    return this.deploymentsService.cancel(environmentId, deploymentId, user.id);
  }
}
