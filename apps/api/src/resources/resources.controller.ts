import type { Resource, User } from '@prisma/client';
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
import { CreateResourceDto } from './dto/create-resource.dto';
import { UpdateResourceDto } from './dto/update-resource.dto';
import { ResourcesService } from './resources.service';

/**
 * Environment-scoped endpoints for listing and creating graph Resource nodes.
 */
@Controller('environments/:environmentId/resources')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Resources')
export class EnvironmentResourcesController {
  public constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  public findAll(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<Resource[]> {
    return this.resourcesService.findAll(environmentId, user.id);
  }

  @Post()
  public create(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateResourceDto,
  ): Promise<Resource> {
    return this.resourcesService.create(environmentId, user.id, dto);
  }
}

/**
 * Id-addressed Resource endpoints.
 */
@Controller('resources')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Resources')
export class ResourcesController {
  public constructor(private readonly resourcesService: ResourcesService) {}

  @Get(':id')
  public findOne(@Param('id') id: string, @CurrentUser() user: User): Promise<Resource> {
    return this.resourcesService.findOne(id, user.id);
  }

  @Patch(':id')
  public update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateResourceDto,
  ): Promise<Resource> {
    return this.resourcesService.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(@Param('id') id: string, @CurrentUser() user: User): Promise<void> {
    await this.resourcesService.delete(id, user.id);
  }
}
