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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BulkImportVariablesDto } from './dto/bulk-import-variables.dto';
import { CreateVariableDto } from './dto/create-variable.dto';
import { UpdateVariableDto } from './dto/update-variable.dto';
import { VariablesService } from './variables.service';
import { BulkImportResult, VariableResponse } from './variables.types';

/**
 * Env-scoped variable endpoints. Inherited by every Service in the env (with
 * per-service overrides via /services/:sid/variables).
 */
@Controller('environments/:environmentId/variables')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Variables')
export class EnvironmentVariablesController {
  public constructor(private readonly variablesService: VariablesService) {}

  @Get()
  public list(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<VariableResponse[]> {
    return this.variablesService.listEnvVariables(environmentId, user.id);
  }

  @Post()
  public create(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateVariableDto,
  ): Promise<VariableResponse> {
    return this.variablesService.createEnvVariable(environmentId, user.id, dto);
  }

  /**
   * Bulk import from a .env-formatted blob. Returns one result per parsed key
   * (`created` | `updated` | `skipped` | `invalid`).
   */
  @Post('import')
  public bulkImport(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
    @Body() dto: BulkImportVariablesDto,
  ): Promise<BulkImportResult[]> {
    return this.variablesService.bulkImportEnvVariables(environmentId, user.id, dto);
  }

  /**
   * Apply current vault values to the live App Platform app WITHOUT rebuilding images.
   *
   * Creates a DeploymentBundle that reuses each service's most recent successful image,
   * runs a single Pulumi up to patch env vars, App Platform restarts containers in place.
   * Use this after editing a variable when you don't want to wait for a full rebuild.
   */
  @Post('apply')
  public applyVariables(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<{ bundleId: string; deploymentCount: number }> {
    return this.variablesService.applyVariables(environmentId, user.id);
  }

  @Patch(':key')
  public update(
    @Param('environmentId') environmentId: string,
    @Param('key') key: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateVariableDto,
  ): Promise<VariableResponse> {
    return this.variablesService.updateEnvVariable(environmentId, user.id, key, dto);
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param('environmentId') environmentId: string,
    @Param('key') key: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.variablesService.deleteEnvVariable(environmentId, user.id, key);
  }
}
