import { Connection, ConnectionKind, Prisma, Role } from '@prisma/client';
import { ErrorCodes } from '@liftoff/shared';
import { Injectable } from '@nestjs/common';
import { Exceptions } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';

/**
 * Manages graph edges (Connections) on the interactive canvas. Edges are the
 * source of truth for env-var auto-injection at apply time (Phase B+). The edge
 * kind is inferred from the source: Resource → RESOURCE_BINDING, Service →
 * SERVICE_LINK. The target is always the consumer Service.
 */
@Injectable()
export class ConnectionsService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Creates an edge after validating both endpoints belong to the env and the
   * edge is legal (no self-link, no duplicate).
   */
  public async create(
    environmentId: string,
    userId: string,
    dto: CreateConnectionDto,
  ): Promise<Connection> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    // Target must be a live service in this environment.
    const target = await this.prismaService.service.findFirst({
      where: { id: dto.targetId, environmentId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      throw Exceptions.badRequest(
        'Connection target must be a service in this environment',
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    // Source resolution: a Resource → RESOURCE_BINDING; otherwise a Service → SERVICE_LINK.
    const sourceResource = await this.prismaService.resource.findFirst({
      where: { id: dto.sourceId, environmentId, deletedAt: null },
      select: { id: true },
    });

    let kind: ConnectionKind;
    let sourceResourceId: string | null = null;
    let sourceServiceId: string | null = null;

    if (sourceResource) {
      kind = ConnectionKind.RESOURCE_BINDING;
      sourceResourceId = dto.sourceId;
    } else {
      const sourceService = await this.prismaService.service.findFirst({
        where: { id: dto.sourceId, environmentId, deletedAt: null },
        select: { id: true },
      });
      if (!sourceService) {
        throw Exceptions.badRequest(
          'Connection source must be a resource or service in this environment',
          ErrorCodes.VALIDATION_ERROR,
        );
      }
      if (dto.sourceId === dto.targetId) {
        throw Exceptions.badRequest('A service cannot link to itself', ErrorCodes.VALIDATION_ERROR);
      }
      kind = ConnectionKind.SERVICE_LINK;
      sourceServiceId = dto.sourceId;
    }

    // Reject duplicate edges (same source → same target).
    const duplicate = await this.prismaService.connection.findFirst({
      where: {
        environmentId,
        targetServiceId: dto.targetId,
        ...(sourceResourceId ? { sourceResourceId } : { sourceServiceId }),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw Exceptions.conflict('This connection already exists', ErrorCodes.VALIDATION_ERROR);
    }

    try {
      return await this.prismaService.connection.create({
        data: {
          environmentId,
          kind,
          sourceResourceId,
          sourceServiceId,
          targetServiceId: dto.targetId,
          injectConfig: dto.injectConfig
            ? (dto.injectConfig as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
    } catch (error) {
      // Backstop for the check-then-insert race: the DB unique index
      // (connections_unique_edge, NULLS NOT DISTINCT) makes duplicate rejection atomic.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Exceptions.conflict('This connection already exists', ErrorCodes.VALIDATION_ERROR);
      }
      throw error;
    }
  }

  /**
   * Lists all edges for an environment.
   */
  public async findAll(environmentId: string, userId: string): Promise<Connection[]> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId);

    return this.prismaService.connection.findMany({
      where: { environmentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Updates an edge's injected-var override.
   */
  public async update(
    connectionId: string,
    userId: string,
    dto: UpdateConnectionDto,
  ): Promise<Connection> {
    const context = await this.getConnectionContext(connectionId);
    await this.projectsService.assertProjectRole(context.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    const data: Prisma.ConnectionUpdateInput = {};
    if (dto.injectConfig !== undefined) {
      data.injectConfig =
        dto.injectConfig === null
          ? Prisma.JsonNull
          : (dto.injectConfig as Prisma.InputJsonValue);
    }

    return this.prismaService.connection.update({ where: { id: connectionId }, data });
  }

  /**
   * Deletes an edge (hard delete — edges are cheap, no soft-delete needed).
   */
  public async delete(connectionId: string, userId: string): Promise<void> {
    const context = await this.getConnectionContext(connectionId);
    await this.projectsService.assertProjectRole(context.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    await this.prismaService.connection.delete({ where: { id: connectionId } });
  }

  private async getEnvironmentContext(environmentId: string): Promise<{
    id: string;
    projectId: string;
  }> {
    const environment = await this.prismaService.environment.findFirst({
      where: { id: environmentId, deletedAt: null },
      select: { id: true, projectId: true },
    });

    if (!environment) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }

    return environment;
  }

  private async getConnectionContext(connectionId: string): Promise<{
    connection: Connection;
    projectId: string;
  }> {
    const connection = await this.prismaService.connection.findFirst({
      where: { id: connectionId, environment: { deletedAt: null } },
      include: { environment: { select: { projectId: true } } },
    });

    if (!connection) {
      throw Exceptions.notFound('Connection not found', ErrorCodes.NOT_FOUND);
    }

    const { environment, ...connectionFields } = connection;
    return { connection: connectionFields, projectId: environment.projectId };
  }
}
