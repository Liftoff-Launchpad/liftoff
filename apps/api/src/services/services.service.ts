import { BuildStrategy, Prisma, Role, Service, ServiceKind } from '@prisma/client';
import { ErrorCodes } from '@liftoff/shared';
import { Injectable, Logger } from '@nestjs/common';
import { Exceptions } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesService } from '../repositories/repositories.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

/**
 * Manages per-environment Service CRUD and ownership checks.
 * A Service represents one App Platform component (service, worker, job, or
 * static site) inside the environment's single DigitalOcean App.
 */
@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly repositoriesService: RepositoriesService,
  ) {}

  /**
   * Creates a new Service under an environment after RBAC checks.
   * Auto-fills `routePath` based on whether this is the first service in the env.
   * Auto-links to the project's primary Repository if `repositoryId` is not given.
   */
  public async create(
    environmentId: string,
    userId: string,
    dto: CreateServiceDto,
  ): Promise<Service> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    const existingServiceCount = await this.prismaService.service.count({
      where: { environmentId, deletedAt: null },
    });
    const resolvedRoutePath = this.resolveRoutePath(dto, existingServiceCount, dto.name);
    const resolvedRepositoryId = environment.project.repository?.id ?? null;

    let created: Service;
    try {
      created = await this.prismaService.service.create({
        data: {
          environmentId,
          repositoryId: resolvedRepositoryId,
          name: dto.name,
          kind: (dto.kind ?? 'SERVICE') as ServiceKind,
          sourceDir: dto.sourceDir ?? '.',
          buildStrategy: (dto.buildStrategy ?? 'AUTO') as BuildStrategy,
          dockerfilePath: dto.dockerfilePath ?? 'Dockerfile',
          port: dto.port ?? 3000,
          instanceSize: dto.instanceSize ?? 'apps-s-1vcpu-0.5gb',
          replicas: dto.replicas ?? 1,
          routePath: resolvedRoutePath,
          healthcheckPath: dto.healthcheckPath ?? null,
          command: dto.command ?? null,
          canvasPosition: dto.canvasPosition
            ? (dto.canvasPosition as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw Exceptions.conflict(
          'Service name already exists in this environment',
          ErrorCodes.VALIDATION_ERROR,
        );
      }
      throw error;
    }

    // Regenerate the GitHub Actions workflow so the next push includes the new
    // service in the matrix. No-op if no repo is connected yet — the workflow
    // file picks up the full service list at connect time.
    await this.syncWorkflowSafely(environmentId, userId);

    return created;
  }

  /**
   * Lists non-deleted Services for an environment, oldest first (creation order
   * matches the "primary service first" mental model used by routePath defaults).
   */
  public async findAll(environmentId: string, userId: string): Promise<Service[]> {
    const environment = await this.getEnvironmentContext(environmentId);
    await this.projectsService.assertProjectRole(environment.projectId, userId);

    return this.prismaService.service.findMany({
      where: { environmentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Returns one Service by ID after RBAC check.
   */
  public async findOne(serviceId: string, userId: string): Promise<Service> {
    const context = await this.getServiceContext(serviceId);
    await this.projectsService.assertProjectRole(context.projectId, userId);
    return context.service;
  }

  /**
   * Updates mutable fields on a Service for OWNER/ADMIN users.
   */
  public async update(
    serviceId: string,
    userId: string,
    dto: UpdateServiceDto,
  ): Promise<Service> {
    const context = await this.getServiceContext(serviceId);
    await this.projectsService.assertProjectRole(context.projectId, userId, [
      Role.OWNER,
      Role.ADMIN,
    ]);

    const updateData: Prisma.ServiceUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.kind !== undefined) updateData.kind = dto.kind as ServiceKind;
    if (dto.sourceDir !== undefined) updateData.sourceDir = dto.sourceDir;
    if (dto.buildStrategy !== undefined) updateData.buildStrategy = dto.buildStrategy as BuildStrategy;
    if (dto.dockerfilePath !== undefined) updateData.dockerfilePath = dto.dockerfilePath;
    if (dto.port !== undefined) updateData.port = dto.port;
    if (dto.instanceSize !== undefined) updateData.instanceSize = dto.instanceSize;
    if (dto.replicas !== undefined) updateData.replicas = dto.replicas;
    if (dto.routePath !== undefined) updateData.routePath = dto.routePath;
    if (dto.healthcheckPath !== undefined) updateData.healthcheckPath = dto.healthcheckPath;
    if (dto.command !== undefined) updateData.command = dto.command;
    if (dto.canvasPosition !== undefined) {
      updateData.canvasPosition = dto.canvasPosition as unknown as Prisma.InputJsonValue;
    }

    let updated: Service;
    try {
      updated = await this.prismaService.service.update({
        where: { id: serviceId },
        data: updateData,
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw Exceptions.conflict(
          'Service name already exists in this environment',
          ErrorCodes.VALIDATION_ERROR,
        );
      }
      throw error;
    }

    // Sync workflow when build-affecting fields changed. Position updates and
    // pure runtime tweaks (instanceSize/replicas) don't need a workflow rebuild —
    // those land via Pulumi on the next deploy.
    const buildFields: (keyof UpdateServiceDto)[] = [
      'name',
      'sourceDir',
      'buildStrategy',
      'dockerfilePath',
    ];
    if (buildFields.some((field) => dto[field] !== undefined)) {
      await this.syncWorkflowSafely(context.service.environmentId, userId);
    }

    return updated;
  }

  /**
   * Soft-deletes a Service for OWNER users only.
   * Phase 1 stores deletedAt; future phases will check for cross-service
   * variable references and block deletion when something points at this service.
   */
  public async delete(serviceId: string, userId: string): Promise<void> {
    const context = await this.getServiceContext(serviceId);
    await this.projectsService.assertProjectRole(context.projectId, userId, [Role.OWNER]);

    // Service is SOFT-deleted, so the Connection FK cascade never fires. Drop the
    // service's graph edges (as consumer target or link source) so getCanvas and
    // connections.findAll don't leak dangling edges — mirrors ResourcesService.delete.
    await this.prismaService.$transaction([
      this.prismaService.connection.deleteMany({
        where: { OR: [{ targetServiceId: serviceId }, { sourceServiceId: serviceId }] },
      }),
      this.prismaService.service.update({
        where: { id: serviceId },
        data: { deletedAt: new Date() },
      }),
    ]);

    await this.syncWorkflowSafely(context.service.environmentId, userId);
  }

  /**
   * Best-effort workflow regeneration. Failures are logged but don't fail the
   * surrounding mutation — the user can re-trigger sync manually if needed.
   */
  private async syncWorkflowSafely(environmentId: string, userId: string): Promise<void> {
    try {
      await this.repositoriesService.syncWorkflowForEnvironment(environmentId, userId);
    } catch (error) {
      this.logger.warn(
        `Failed to sync GitHub workflow for env ${environmentId} after service mutation: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async getEnvironmentContext(environmentId: string): Promise<{
    id: string;
    projectId: string;
    project: { repository: { id: string } | null };
  }> {
    const environment = await this.prismaService.environment.findFirst({
      where: { id: environmentId, deletedAt: null },
      select: {
        id: true,
        projectId: true,
        project: {
          select: {
            repository: { select: { id: true } },
          },
        },
      },
    });

    if (!environment) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }

    return environment;
  }

  private async getServiceContext(serviceId: string): Promise<{
    service: Service;
    projectId: string;
  }> {
    const service = await this.prismaService.service.findFirst({
      where: { id: serviceId, deletedAt: null },
      include: {
        environment: { select: { projectId: true } },
      },
    });

    if (!service) {
      throw Exceptions.notFound('Service not found', ErrorCodes.NOT_FOUND);
    }

    const { environment, ...serviceFields } = service;
    return { service: serviceFields, projectId: environment.projectId };
  }

  private resolveRoutePath(
    dto: CreateServiceDto,
    existingServiceCount: number,
    serviceName: string,
  ): string | null {
    if (dto.routePath !== undefined) {
      return dto.routePath;
    }

    if (existingServiceCount === 0) {
      return '/';
    }

    return `/${serviceName}`;
  }

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
