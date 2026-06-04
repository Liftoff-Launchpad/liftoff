import type { User } from '@prisma/client';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ErrorCodes } from '@liftoff/shared';
import { CurrentUser } from '../common/decorators';
import { Exceptions } from '../common/exceptions/app.exception';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ConnectRepositoryDto } from './dto/connect-repository.dto';
import { ScanEnvExampleDto, ScanEnvExampleResult } from './dto/scan-env-example.dto';
import { GitHubRepo } from './github.service';
import { ConnectedRepository, RepositoriesService } from './repositories.service';

/**
 * Project-scoped GitHub repository connection endpoints.
 */
@Controller('projects/:projectId/repository')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Repositories')
export class RepositoriesController {
  public constructor(private readonly repositoriesService: RepositoriesService) {}

  /**
   * Lists available GitHub repositories for the authenticated user.
   */
  @Get('available')
  public findAvailable(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ): Promise<GitHubRepo[]> {
    return this.repositoriesService.listAvailable(projectId, user.id);
  }

  /**
   * Returns the connected repository for a project.
   */
  @Get()
  public async findConnected(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ): Promise<ConnectedRepository> {
    const repository = await this.repositoriesService.findByProject(projectId, user.id);
    if (!repository) {
      throw Exceptions.notFound('Repository not connected', ErrorCodes.REPOSITORY_NOT_FOUND);
    }

    return repository;
  }

  /**
   * Connects a GitHub repository to a project.
   */
  @Post()
  public async connect(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: ConnectRepositoryDto,
  ): Promise<ConnectedRepository> {
    return this.repositoriesService.connect(projectId, user.id, dto);
  }

  /**
   * Scans the connected repo's branch for `.env.example` (or `.env.sample` /
   * `.env.template`) under an optional source dir. Used by the onboarding flow
   * to pre-populate the "fill in your env vars" step before the first deploy.
   */
  @Post('scan-env-example')
  public scanEnvExample(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: ScanEnvExampleDto,
  ): Promise<ScanEnvExampleResult> {
    return this.repositoriesService.scanEnvExample(projectId, user.id, dto);
  }

  /**
   * Disconnects the project's primary repository (single-repo back-compat).
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  public async disconnect(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.repositoriesService.disconnect(projectId, user.id);
  }
}

/**
 * Phase F multi-repo endpoints: a project may link many repositories, each
 * contributing services to its environments' Apps.
 */
@Controller('projects/:projectId/repositories')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Repositories')
export class ProjectRepositoriesController {
  public constructor(private readonly repositoriesService: RepositoriesService) {}

  /**
   * Lists every repository linked to the project (oldest = primary first).
   */
  @Get()
  public findAll(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ): Promise<ConnectedRepository[]> {
    return this.repositoriesService.findAllByProject(projectId, user.id);
  }

  /**
   * Links an additional GitHub repository to the project.
   */
  @Post()
  public connect(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: ConnectRepositoryDto,
  ): Promise<ConnectedRepository> {
    return this.repositoriesService.connect(projectId, user.id, dto);
  }

  /**
   * Disconnects one specific repository by id.
   */
  @Delete(':repositoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(
    @Param('projectId') projectId: string,
    @Param('repositoryId') repositoryId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.repositoriesService.disconnect(projectId, user.id, repositoryId);
  }
}
