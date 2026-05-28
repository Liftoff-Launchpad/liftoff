import type { User } from '@prisma/client';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RepositoriesService } from '../repositories/repositories.service';
import { VariablesService } from '../variables/variables.service';
import { ConfigYamlDto } from './dto/config-yaml.dto';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';
import {
  ConfigValidationResponse,
  EnvironmentDetail,
  EnvironmentListItem,
  EnvironmentsService,
} from './environments.service';

/**
 * Project-scoped environment CRUD and config endpoints.
 */
@Controller('projects/:projectId/environments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Environments')
export class EnvironmentsController {
  public constructor(
    private readonly environmentsService: EnvironmentsService,
    private readonly variablesService: VariablesService,
    private readonly repositoriesService: RepositoriesService,
  ) {}

  /**
   * Creates an environment under a project.
   */
  @Post()
  public create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateEnvironmentDto,
  ) {
    return this.environmentsService.create(projectId, user.id, dto);
  }

  /**
   * Lists environments for a project.
   */
  @Get()
  public findAll(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ): Promise<EnvironmentListItem[]> {
    return this.environmentsService.findAll(projectId, user.id);
  }

  /**
   * Returns one environment by ID.
   */
  @Get(':id')
  public findOne(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<EnvironmentDetail> {
    return this.environmentsService.findOne(projectId, id, user.id);
  }

  /**
   * Updates mutable environment fields.
   */
  @Patch(':id')
  public update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateEnvironmentDto,
  ) {
    return this.environmentsService.update(projectId, id, user.id, dto);
  }

  /**
   * Soft-deletes an environment.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.environmentsService.delete(projectId, id, user.id);
  }

  /**
   * Validates and persists environment liftoff.yml.
   */
  @Put(':id/config')
  public updateConfig(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: ConfigYamlDto,
  ) {
    return this.environmentsService.updateConfig(projectId, id, user.id, dto.configYaml);
  }

  /**
   * Validates environment liftoff.yml without writing to the database.
   */
  @Post(':id/config/validate')
  public validateConfig(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: ConfigYamlDto,
  ): Promise<ConfigValidationResponse> {
    return this.environmentsService.validateConfig(projectId, id, user.id, dto);
  }

  /**
   * Redeploys the environment using each service's most recent SUCCESS image —
   * no rebuild. Same machinery as POST /variables/apply (creates a DeploymentBundle,
   * enqueues a single Pulumi up). The Pulumi run reconciles the App Platform spec
   * to the current Service rows, so any services deleted since the last deploy
   * are dropped from the App and remaining services are restarted with their
   * existing tags.
   *
   * Typical recovery flow: a bad service breaks the bundle → user deletes the
   * bad service from the canvas → clicks Redeploy → Pulumi drops the deleted
   * service from the App spec and brings the rest back with their last good images.
   *
   * Returns 400 if any remaining service has never deployed successfully (no image
   * to reuse). For that case, use POST /build instead — it triggers a fresh build.
   */
  @Post(':id/redeploy')
  public redeploy(
    @Param('id') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<{ bundleId: string; deploymentCount: number }> {
    return this.variablesService.applyVariables(environmentId, user.id);
  }

  /**
   * Triggers a fresh GitHub Actions build for the env (workflow_dispatch). Use
   * this when:
   *   - No service has ever deployed successfully (Redeploy would fail —
   *     nothing to reuse).
   *   - A prior build/push failed and you want to retry from the latest commit
   *     without pushing a "kick deploy" commit.
   *   - You changed BUILD-scope variables and want to rebuild with the new values.
   *
   * Re-syncs the workflow file first (idempotent), then dispatches it on the
   * env's branch. The standard webhook → deploy-complete → bundle pipeline takes
   * over from there. Returns metadata so the UI can deep-link to the Actions tab.
   */
  @Post(':id/build')
  public triggerBuild(
    @Param('id') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<{ workflowFile: string; ref: string; repository: string; bundleId: string }> {
    return this.repositoriesService.triggerBuildForEnvironment(environmentId, user.id);
  }
}
