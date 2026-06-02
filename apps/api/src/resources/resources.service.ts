import { Prisma, Resource, ResourceKind, ResourceStatus, Role } from '@prisma/client';
import { ErrorCodes } from '@liftoff/shared';
import { Injectable, Logger } from '@nestjs/common';
import { Exceptions } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateResourceDto } from './dto/create-resource.dto';
import { UpdateResourceDto } from './dto/update-resource.dto';

/** Default node name per resource kind when the caller doesn't supply one. */
const DEFAULT_NAME_BY_KIND: Record<ResourceKind, string> = {
  POSTGRES: 'main-db',
  REDIS: 'cache',
  SPACES_BUCKET: 'main-bucket',
};

/**
 * Manages graph Resource nodes (managed Postgres / Redis / Spaces bucket) on the
 * interactive canvas. A Resource is created DRAFT and provisioned on apply
 * (Phase B+). See INTERACTIVE_GRAPH_PLAN.md.
 */
@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Creates a DRAFT Resource under an environment. Auto-resolves a unique
   * kind-based name when one isn't given.
   */
  public async create(
    environmentId: string,
    userId: string,
    dto: CreateResourceDto,
  ): Promise<Resource> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    const kind = dto.kind as ResourceKind;
    const name = dto.name ?? (await this.resolveDefaultName(environmentId, kind));

    try {
      return await this.prismaService.resource.create({
        data: {
          environmentId,
          kind,
          name,
          status: ResourceStatus.DRAFT,
          config: dto.config ? (dto.config as Prisma.InputJsonValue) : Prisma.JsonNull,
          canvasPosition: dto.canvasPosition
            ? (dto.canvasPosition as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw Exceptions.conflict(
          'Resource name already exists in this environment',
          ErrorCodes.VALIDATION_ERROR,
        );
      }
      throw error;
    }
  }

  /**
   * Lists non-deleted Resources for an environment, oldest first.
   */
  public async findAll(environmentId: string, userId: string): Promise<Resource[]> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId);

    return this.prismaService.resource.findMany({
      where: { environmentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Returns one Resource by ID after RBAC check.
   */
  public async findOne(resourceId: string, userId: string): Promise<Resource> {
    const context = await this.getResourceContext(resourceId);
    await this.projectsService.assertProjectRole(context.projectId, userId);
    return context.resource;
  }

  /**
   * Updates mutable fields (name / config / canvasPosition) for OWNER/ADMIN.
   */
  public async update(
    resourceId: string,
    userId: string,
    dto: UpdateResourceDto,
  ): Promise<Resource> {
    const context = await this.getResourceContext(resourceId);
    await this.projectsService.assertProjectRole(context.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    const data: Prisma.ResourceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.config !== undefined) data.config = dto.config as Prisma.InputJsonValue;
    if (dto.canvasPosition !== undefined) {
      data.canvasPosition = dto.canvasPosition as unknown as Prisma.InputJsonValue;
    }

    try {
      return await this.prismaService.resource.update({ where: { id: resourceId }, data });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw Exceptions.conflict(
          'Resource name already exists in this environment',
          ErrorCodes.VALIDATION_ERROR,
        );
      }
      throw error;
    }
  }

  /**
   * Removes a Resource node and its edges.
   *
   * DRAFT resources never reached the cloud, so they're hard-deleted (the FK
   * cascade drops their connections). ACTIVE/provisioned resources are
   * soft-deleted (so Phase B can track the pending Pulumi destroy) and their
   * edges are dropped. The "block destroying an ACTIVE resource that services
   * depend on" guardrail (plan D6) lands in Phase B, where apply actually tears
   * down cloud infra — in Phase A a node is inert canvas state.
   */
  public async delete(resourceId: string, userId: string): Promise<void> {
    const context = await this.getResourceContext(resourceId);
    await this.projectsService.assertProjectRole(context.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    if (context.resource.status === ResourceStatus.DRAFT) {
      // FK cascade on Connection.sourceResource drops the edges.
      await this.prismaService.resource.delete({ where: { id: resourceId } });
      return;
    }

    await this.prismaService.$transaction([
      this.prismaService.connection.deleteMany({ where: { sourceResourceId: resourceId } }),
      this.prismaService.resource.update({
        where: { id: resourceId },
        data: {
          deletedAt: new Date(),
          // Free the (environmentId, name) unique slot — that index spans
          // soft-deleted rows, so without renaming, the name would be burned and
          // the user could never re-create a resource with the same name. The id
          // keeps the row globally unique.
          name: `${context.resource.name}__deleted__${resourceId}`,
        },
      }),
    ]);
  }

  /**
   * Picks a unique default name for a new resource of the given kind, accounting
   * for the (environmentId, name) unique constraint which spans soft-deleted rows.
   */
  private async resolveDefaultName(environmentId: string, kind: ResourceKind): Promise<string> {
    const base = DEFAULT_NAME_BY_KIND[kind];
    const existing = await this.prismaService.resource.findMany({
      where: { environmentId, name: { startsWith: base } },
      select: { name: true },
    });
    const taken = new Set(existing.map((resource) => resource.name));
    if (!taken.has(base)) {
      return base;
    }
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    return `${base}-${Math.floor(Date.now() / 1000)}`;
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

  private async getResourceContext(resourceId: string): Promise<{
    resource: Resource;
    projectId: string;
  }> {
    const resource = await this.prismaService.resource.findFirst({
      where: { id: resourceId, deletedAt: null, environment: { deletedAt: null } },
      include: { environment: { select: { projectId: true } } },
    });

    if (!resource) {
      throw Exceptions.notFound('Resource not found', ErrorCodes.NOT_FOUND);
    }

    const { environment, ...resourceFields } = resource;
    return { resource: resourceFields, projectId: environment.projectId };
  }

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
