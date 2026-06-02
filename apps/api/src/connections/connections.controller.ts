import type { Connection, User } from '@prisma/client';
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
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { ConnectionsService } from './connections.service';

/**
 * Environment-scoped endpoints for listing and creating graph edges.
 */
@Controller('environments/:environmentId/connections')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Connections')
export class EnvironmentConnectionsController {
  public constructor(private readonly connectionsService: ConnectionsService) {}

  @Get()
  public findAll(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
  ): Promise<Connection[]> {
    return this.connectionsService.findAll(environmentId, user.id);
  }

  @Post()
  public create(
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateConnectionDto,
  ): Promise<Connection> {
    return this.connectionsService.create(environmentId, user.id, dto);
  }
}

/**
 * Id-addressed Connection endpoints.
 */
@Controller('connections')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Connections')
export class ConnectionsController {
  public constructor(private readonly connectionsService: ConnectionsService) {}

  @Patch(':id')
  public update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateConnectionDto,
  ): Promise<Connection> {
    return this.connectionsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(@Param('id') id: string, @CurrentUser() user: User): Promise<void> {
    await this.connectionsService.delete(id, user.id);
  }
}
