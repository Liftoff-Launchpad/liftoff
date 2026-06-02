import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MonitoringService } from './monitoring.service';
import type { User } from '@prisma/client';

/**
 * Monitoring endpoints for viewing logs and metrics.
 */
@Controller('environments/:environmentId')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Monitoring')
export class MonitoringController {
  public constructor(private readonly monitoringService: MonitoringService) {}

  /**
   * Fetches application logs. When `service` is provided, scopes to that App
   * Platform component (per-service logs); otherwise returns env-wide logs.
   */
  @Get('logs')
  public getLogs(
    @Param('environmentId') environmentId: string,
    @Query('type') type?: 'BUILD' | 'DEPLOY' | 'RUN' | 'RUN_RESTARTED',
    @Query('limit') limit?: string,
    @Query('service') service?: string,
    @CurrentUser() user?: User,
  ) {
    const numLimit = limit ? Math.min(parseInt(limit, 10), 500) : 200;
    return this.monitoringService.getLogs(
      environmentId,
      user?.id ?? '',
      type ?? 'RUN',
      numLimit,
      service?.trim() || undefined,
    );
  }

  /**
   * Fetches CPU percentage metrics.
   */
  @Get('metrics/cpu')
  public getCpuMetrics(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user?: User,
  ) {
    return this.monitoringService.getMetrics(environmentId, user?.id ?? '', 'cpu');
  }

  /**
   * Fetches memory percentage metrics.
   */
  @Get('metrics/memory')
  public getMemoryMetrics(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user?: User,
  ) {
    return this.monitoringService.getMetrics(environmentId, user?.id ?? '', 'memory');
  }

  /**
   * Fetches network bandwidth metrics.
   */
  @Get('metrics/bandwidth')
  public getBandwidthMetrics(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user?: User,
  ) {
    return this.monitoringService.getMetrics(environmentId, user?.id ?? '', 'bandwidth');
  }
}
