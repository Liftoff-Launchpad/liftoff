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
   * Fetches CPU percentage metrics. `service` scopes to one App Platform
   * component; `range` (1h/6h/1d/7d/30d) selects the time window.
   */
  @Get('metrics/cpu')
  public getCpuMetrics(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user?: User,
    @Query('service') service?: string,
    @Query('range') range?: string,
  ) {
    return this.monitoringService.getMetrics(
      environmentId,
      user?.id ?? '',
      'cpu',
      service?.trim() || undefined,
      rangeToHours(range),
    );
  }

  /**
   * Fetches memory percentage metrics.
   */
  @Get('metrics/memory')
  public getMemoryMetrics(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user?: User,
    @Query('service') service?: string,
    @Query('range') range?: string,
  ) {
    return this.monitoringService.getMetrics(
      environmentId,
      user?.id ?? '',
      'memory',
      service?.trim() || undefined,
      rangeToHours(range),
    );
  }

  /**
   * Fetches network bandwidth metrics.
   */
  @Get('metrics/bandwidth')
  public getBandwidthMetrics(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user?: User,
    @Query('service') service?: string,
    @Query('range') range?: string,
  ) {
    return this.monitoringService.getMetrics(
      environmentId,
      user?.id ?? '',
      'bandwidth',
      service?.trim() || undefined,
      rangeToHours(range),
    );
  }

  /**
   * Fetches restart-count metrics — how many times the container restarted in
   * the window. A climbing restart count is the canonical crash-loop signal.
   */
  @Get('metrics/restart-count')
  public getRestartCountMetrics(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user?: User,
    @Query('service') service?: string,
    @Query('range') range?: string,
  ) {
    return this.monitoringService.getMetrics(
      environmentId,
      user?.id ?? '',
      'restart',
      service?.trim() || undefined,
      rangeToHours(range),
    );
  }
}

/** Maps a UI range token to a window size in hours. */
function rangeToHours(range: string | undefined): number {
  switch (range) {
    case '6h':
      return 6;
    case '1d':
      return 24;
    case '7d':
      return 168;
    case '30d':
      return 720;
    default:
      return 1;
  }
}
