import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { CanvasService, AutoSetupResult, CanvasState } from './canvas.service';
import { AutoSetupDto } from './dto/auto-setup.dto';
import { SaveLayoutDto } from './dto/save-layout.dto';

@Controller('projects/:projectId/canvas')
@UseGuards(JwtAuthGuard)
export class CanvasController {
  public constructor(private readonly canvasService: CanvasService) {}

  /**
   * POST /projects/:projectId/canvas/auto-setup
   * The "magic button" — connects repo and triggers first deployment.
   */
  @Post('auto-setup')
  async autoSetup(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: AutoSetupDto,
  ): Promise<AutoSetupResult> {
    return this.canvasService.autoSetup(projectId, user.id, dto);
  }

  /**
   * GET /projects/:projectId/canvas
   * Returns the enriched canvas state (nodes + edges + live status).
   */
  @Get()
  async getCanvas(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ): Promise<CanvasState> {
    return this.canvasService.getCanvas(projectId, user.id);
  }

  /**
   * PATCH /projects/:projectId/canvas/layout
   * Saves only node positions (no deploy side effects).
   */
  @Patch('layout')
  async saveLayout(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: SaveLayoutDto,
  ): Promise<void> {
    return this.canvasService.saveLayout(projectId, user.id, dto);
  }
}
