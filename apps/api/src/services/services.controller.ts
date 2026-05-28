import type { Service, User } from '@prisma/client';
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
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

/**
 * Environment-scoped endpoints for listing and creating Services.
 */
@Controller('environments/:environmentId/services')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Services')
export class EnvironmentServicesController {
  public constructor(private readonly servicesService: ServicesService) {}

  /**
   * Lists Services for an environment, in creation order.
   */
  @Get()
  public findAll(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<Service[]> {
    return this.servicesService.findAll(environmentId, user.id);
  }

  /**
   * Creates a new Service under an environment.
   */
  @Post()
  public create(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateServiceDto,
  ): Promise<Service> {
    return this.servicesService.create(environmentId, user.id, dto);
  }
}

/**
 * Service-scoped endpoints (id-addressed, env-less for ergonomics).
 */
@Controller('services')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Services')
export class ServicesController {
  public constructor(private readonly servicesService: ServicesService) {}

  /**
   * Returns one Service by ID.
   */
  @Get(':id')
  public findOne(@Param('id') id: string, @CurrentUser() user: User): Promise<Service> {
    return this.servicesService.findOne(id, user.id);
  }

  /**
   * Updates mutable fields on a Service.
   */
  @Patch(':id')
  public update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateServiceDto,
  ): Promise<Service> {
    return this.servicesService.update(id, user.id, dto);
  }

  /**
   * Soft-deletes a Service.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(@Param('id') id: string, @CurrentUser() user: User): Promise<void> {
    await this.servicesService.delete(id, user.id);
  }
}
