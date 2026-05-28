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
import {
  BulkImportResult,
  ResolvedVariableEntry,
  VariableResponse,
} from './variables.types';

/**
 * Service-scoped variable endpoints. Service variables override env-scoped
 * variables with the same key for THIS service only.
 */
@Controller('services/:serviceId/variables')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Variables')
export class ServiceVariablesController {
  public constructor(private readonly variablesService: VariablesService) {}

  @Get()
  public list(
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: User,
  ): Promise<VariableResponse[]> {
    return this.variablesService.listServiceVariables(serviceId, user.id);
  }

  @Post()
  public create(
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateVariableDto,
  ): Promise<VariableResponse> {
    return this.variablesService.createServiceVariable(serviceId, user.id, dto);
  }

  @Post('import')
  public bulkImport(
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: User,
    @Body() dto: BulkImportVariablesDto,
  ): Promise<BulkImportResult[]> {
    return this.variablesService.bulkImportServiceVariables(serviceId, user.id, dto);
  }

  /**
   * Debug view: env-scoped + service-scoped merged with override resolution.
   * SECRET values are redacted (`null`) — this endpoint is for the UI's
   * "what does my service see at runtime" panel, not for retrieving secret values.
   */
  @Get('resolved')
  public resolved(
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: User,
  ): Promise<ResolvedVariableEntry[]> {
    return this.variablesService.resolveForService(serviceId, user.id);
  }

  @Patch(':key')
  public update(
    @Param('serviceId') serviceId: string,
    @Param('key') key: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateVariableDto,
  ): Promise<VariableResponse> {
    return this.variablesService.updateServiceVariable(serviceId, user.id, key, dto);
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param('serviceId') serviceId: string,
    @Param('key') key: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.variablesService.deleteServiceVariable(serviceId, user.id, key);
  }
}
