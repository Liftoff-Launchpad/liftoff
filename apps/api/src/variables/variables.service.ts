import { InjectQueue } from '@nestjs/bullmq';
import {
  DeploymentBundleStatus,
  DeploymentStatus,
  EnvironmentVariable,
  Prisma,
  Role,
  Service,
  ServiceVariable,
  VariableKind,
  VariableScope,
} from '@prisma/client';
import { ErrorCodes, safeParseLiftoffConfigAny } from '@liftoff/shared';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import * as yaml from 'js-yaml';
import { Exceptions } from '../common/exceptions/app.exception';
import { EncryptionService } from '../common/services/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesService } from '../repositories/repositories.service';
import {
  InfraProvisionJobPayload,
  JOB_NAMES,
  QUEUE_NAMES,
  QUEUE_TIMEOUTS,
} from '../queues/queue.constants';
import { BulkImportVariablesDto } from './dto/bulk-import-variables.dto';
import { CreateVariableDto } from './dto/create-variable.dto';
import { UpdateVariableDto } from './dto/update-variable.dto';
import {
  BulkImportResult,
  ResolvedVariableEntry,
  VariableResponse,
} from './variables.types';

type EnvContext = {
  id: string;
  projectId: string;
};

type ServiceContext = {
  service: { id: string; environmentId: string };
  projectId: string;
};

const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Vault for env-scoped and service-scoped variables.
 *
 * Values are AES-256-GCM encrypted via EncryptionService (same pattern as
 * DOAccount.doToken). SECRET kind variables are write-only: the API never
 * returns the plaintext, but internal callers (Pulumi integration, resolver)
 * can read via `resolveForService` which returns real values for deploy injection.
 *
 * Inheritance: a Service inherits every env-scoped variable; a ServiceVariable
 * with the same key overrides it for that service only. This matches the
 * Kubernetes/Docker mental model and lets you set `NODE_ENV=production` once
 * per env without repeating it on each service.
 */
@Injectable()
export class VariablesService {
  private readonly logger = new Logger(VariablesService.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly encryptionService: EncryptionService,
    @Inject(forwardRef(() => RepositoriesService))
    private readonly repositoriesService: RepositoriesService,
    @InjectQueue(QUEUE_NAMES.INFRASTRUCTURE)
    private readonly infrastructureQueue: Queue<InfraProvisionJobPayload>,
  ) {}

  /**
   * Fire-and-forget GitHub side sync. Called after every variable mutation that
   * touches a BUILD/BOTH-scope row (or could — we call unconditionally and let
   * the sync helpers no-op when there's nothing to push). Failures are logged
   * but don't fail the mutation.
   */
  private async syncGithubSafely(
    environmentId: string,
    userId: string,
    affectsBuildScope: boolean,
  ): Promise<void> {
    if (!affectsBuildScope) return;
    try {
      await this.repositoriesService.syncBuildVariablesForEnvironment(environmentId, userId);
      await this.repositoriesService.syncWorkflowForEnvironment(environmentId, userId);
    } catch (error) {
      this.logger.warn(
        `GitHub sync failed for env ${environmentId} after variable change: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  // ───────────────────────── env-scoped CRUD ─────────────────────────

  public async listEnvVariables(envId: string, userId: string): Promise<VariableResponse[]> {
    const ctx = await this.getEnvContextOrThrow(envId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId);

    const rows = await this.prismaService.environmentVariable.findMany({
      where: { environmentId: envId },
      orderBy: [{ key: 'asc' }],
    });
    return rows.map((row) => this.toEnvResponse(row));
  }

  public async createEnvVariable(
    envId: string,
    userId: string,
    dto: CreateVariableDto,
  ): Promise<VariableResponse> {
    const ctx = await this.getEnvContextOrThrow(envId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);
    this.assertValidKey(dto.key);

    const scope = (dto.scope ?? 'RUNTIME') as VariableScope;
    try {
      const created = await this.prismaService.environmentVariable.create({
        data: {
          environmentId: envId,
          key: dto.key,
          encryptedValue: this.encryptionService.encrypt(dto.value),
          scope,
          kind: (dto.kind ?? 'PLAIN') as VariableKind,
          createdBy: userId,
          lastRotatedAt: new Date(),
        },
      });
      await this.syncGithubSafely(envId, userId, this.touchesBuild(scope));
      return this.toEnvResponse(created);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw Exceptions.conflict(
          `Variable ${dto.key} already exists for this environment`,
          ErrorCodes.VALIDATION_ERROR,
        );
      }
      throw error;
    }
  }

  public async updateEnvVariable(
    envId: string,
    userId: string,
    key: string,
    dto: UpdateVariableDto,
  ): Promise<VariableResponse> {
    const ctx = await this.getEnvContextOrThrow(envId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);

    const row = await this.prismaService.environmentVariable.findUnique({
      where: { environmentId_key: { environmentId: envId, key } },
    });
    if (!row) {
      throw Exceptions.notFound(`Variable ${key} not found`, ErrorCodes.NOT_FOUND);
    }

    const data: Prisma.EnvironmentVariableUpdateInput = {};
    if (dto.value !== undefined) {
      data.encryptedValue = this.encryptionService.encrypt(dto.value);
      data.lastRotatedAt = new Date();
    }
    if (dto.scope !== undefined) data.scope = dto.scope as VariableScope;
    if (dto.kind !== undefined) data.kind = dto.kind as VariableKind;

    const updated = await this.prismaService.environmentVariable.update({
      where: { id: row.id },
      data,
    });
    // Sync if old OR new scope touches BUILD (covers scope demotion BUILD→RUNTIME
    // which still needs Actions secret cleanup).
    await this.syncGithubSafely(
      envId,
      userId,
      this.touchesBuild(row.scope) || this.touchesBuild(updated.scope),
    );
    return this.toEnvResponse(updated);
  }

  public async deleteEnvVariable(envId: string, userId: string, key: string): Promise<void> {
    const ctx = await this.getEnvContextOrThrow(envId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);

    const existing = await this.prismaService.environmentVariable.findUnique({
      where: { environmentId_key: { environmentId: envId, key } },
      select: { scope: true },
    });
    if (!existing) {
      throw Exceptions.notFound(`Variable ${key} not found`, ErrorCodes.NOT_FOUND);
    }

    await this.prismaService.environmentVariable.delete({
      where: { environmentId_key: { environmentId: envId, key } },
    });
    await this.syncGithubSafely(envId, userId, this.touchesBuild(existing.scope));
  }

  public async bulkImportEnvVariables(
    envId: string,
    userId: string,
    dto: BulkImportVariablesDto,
  ): Promise<BulkImportResult[]> {
    const ctx = await this.getEnvContextOrThrow(envId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);

    const parsed = this.parseEnvFile(dto.envFileContent);
    const scope = (dto.defaultScope ?? 'RUNTIME') as VariableScope;
    const kind: VariableKind = dto.markAllAsSecret ? 'SECRET' : 'PLAIN';
    const overwrite = dto.overwriteExisting === true;

    const results: BulkImportResult[] = [];
    for (const { key, value, invalidReason } of parsed) {
      if (invalidReason) {
        results.push({ key, status: 'invalid', reason: invalidReason });
        continue;
      }
      try {
        const encryptedValue = this.encryptionService.encrypt(value);
        const existing = await this.prismaService.environmentVariable.findUnique({
          where: { environmentId_key: { environmentId: envId, key } },
        });

        if (existing && !overwrite) {
          results.push({ key, status: 'skipped', reason: 'already exists' });
          continue;
        }

        if (existing) {
          await this.prismaService.environmentVariable.update({
            where: { id: existing.id },
            data: {
              encryptedValue,
              scope,
              kind,
              lastRotatedAt: new Date(),
            },
          });
          results.push({ key, status: 'updated' });
        } else {
          await this.prismaService.environmentVariable.create({
            data: {
              environmentId: envId,
              key,
              encryptedValue,
              scope,
              kind,
              createdBy: userId,
              lastRotatedAt: new Date(),
            },
          });
          results.push({ key, status: 'created' });
        }
      } catch (error) {
        results.push({
          key,
          status: 'invalid',
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
    await this.syncGithubSafely(envId, userId, this.touchesBuild(scope));
    return results;
  }

  // ─────────────────────── service-scoped CRUD ───────────────────────

  public async listServiceVariables(serviceId: string, userId: string): Promise<VariableResponse[]> {
    const ctx = await this.getServiceContextOrThrow(serviceId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId);

    const rows = await this.prismaService.serviceVariable.findMany({
      where: { serviceId },
      orderBy: [{ key: 'asc' }],
    });
    return rows.map((row) => this.toServiceResponse(row));
  }

  public async createServiceVariable(
    serviceId: string,
    userId: string,
    dto: CreateVariableDto,
  ): Promise<VariableResponse> {
    const ctx = await this.getServiceContextOrThrow(serviceId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);
    this.assertValidKey(dto.key);

    const scope = (dto.scope ?? 'RUNTIME') as VariableScope;
    try {
      const created = await this.prismaService.serviceVariable.create({
        data: {
          serviceId,
          key: dto.key,
          encryptedValue: this.encryptionService.encrypt(dto.value),
          scope,
          kind: (dto.kind ?? 'PLAIN') as VariableKind,
          createdBy: userId,
          lastRotatedAt: new Date(),
        },
      });
      await this.syncGithubSafely(
        ctx.service.environmentId,
        userId,
        this.touchesBuild(scope),
      );
      return this.toServiceResponse(created);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw Exceptions.conflict(
          `Variable ${dto.key} already exists for this service`,
          ErrorCodes.VALIDATION_ERROR,
        );
      }
      throw error;
    }
  }

  public async updateServiceVariable(
    serviceId: string,
    userId: string,
    key: string,
    dto: UpdateVariableDto,
  ): Promise<VariableResponse> {
    const ctx = await this.getServiceContextOrThrow(serviceId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);

    const row = await this.prismaService.serviceVariable.findUnique({
      where: { serviceId_key: { serviceId, key } },
    });
    if (!row) {
      throw Exceptions.notFound(`Variable ${key} not found`, ErrorCodes.NOT_FOUND);
    }

    const data: Prisma.ServiceVariableUpdateInput = {};
    if (dto.value !== undefined) {
      data.encryptedValue = this.encryptionService.encrypt(dto.value);
      data.lastRotatedAt = new Date();
    }
    if (dto.scope !== undefined) data.scope = dto.scope as VariableScope;
    if (dto.kind !== undefined) data.kind = dto.kind as VariableKind;

    const updated = await this.prismaService.serviceVariable.update({
      where: { id: row.id },
      data,
    });
    await this.syncGithubSafely(
      ctx.service.environmentId,
      userId,
      this.touchesBuild(row.scope) || this.touchesBuild(updated.scope),
    );
    return this.toServiceResponse(updated);
  }

  public async deleteServiceVariable(
    serviceId: string,
    userId: string,
    key: string,
  ): Promise<void> {
    const ctx = await this.getServiceContextOrThrow(serviceId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);

    const existing = await this.prismaService.serviceVariable.findUnique({
      where: { serviceId_key: { serviceId, key } },
      select: { scope: true },
    });
    if (!existing) {
      throw Exceptions.notFound(`Variable ${key} not found`, ErrorCodes.NOT_FOUND);
    }

    await this.prismaService.serviceVariable.delete({
      where: { serviceId_key: { serviceId, key } },
    });
    await this.syncGithubSafely(
      ctx.service.environmentId,
      userId,
      this.touchesBuild(existing.scope),
    );
  }

  public async bulkImportServiceVariables(
    serviceId: string,
    userId: string,
    dto: BulkImportVariablesDto,
  ): Promise<BulkImportResult[]> {
    const ctx = await this.getServiceContextOrThrow(serviceId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);

    const parsed = this.parseEnvFile(dto.envFileContent);
    const scope = (dto.defaultScope ?? 'RUNTIME') as VariableScope;
    const kind: VariableKind = dto.markAllAsSecret ? 'SECRET' : 'PLAIN';
    const overwrite = dto.overwriteExisting === true;

    const results: BulkImportResult[] = [];
    for (const { key, value, invalidReason } of parsed) {
      if (invalidReason) {
        results.push({ key, status: 'invalid', reason: invalidReason });
        continue;
      }
      try {
        const encryptedValue = this.encryptionService.encrypt(value);
        const existing = await this.prismaService.serviceVariable.findUnique({
          where: { serviceId_key: { serviceId, key } },
        });

        if (existing && !overwrite) {
          results.push({ key, status: 'skipped', reason: 'already exists' });
          continue;
        }

        if (existing) {
          await this.prismaService.serviceVariable.update({
            where: { id: existing.id },
            data: {
              encryptedValue,
              scope,
              kind,
              lastRotatedAt: new Date(),
            },
          });
          results.push({ key, status: 'updated' });
        } else {
          await this.prismaService.serviceVariable.create({
            data: {
              serviceId,
              key,
              encryptedValue,
              scope,
              kind,
              createdBy: userId,
              lastRotatedAt: new Date(),
            },
          });
          results.push({ key, status: 'created' });
        }
      } catch (error) {
        results.push({
          key,
          status: 'invalid',
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
    await this.syncGithubSafely(
      ctx.service.environmentId,
      userId,
      this.touchesBuild(scope),
    );
    return results;
  }

  /**
   * Resolved view for the UI: merges env + service vars, applies redaction for
   * SECRETs, tags each entry with its source.
   *
   * For internal use that needs real values (Pulumi env injection, GitHub
   * Actions secret sync), see `resolveForServiceInternal` below.
   */
  public async resolveForService(
    serviceId: string,
    userId: string,
  ): Promise<ResolvedVariableEntry[]> {
    const ctx = await this.getServiceContextOrThrow(serviceId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId);

    const merged = await this.resolveForServiceInternal(serviceId);
    return merged.map((entry) => ({
      ...entry,
      // Redact secrets — debug view shows the KEY is set, not the value
      value: entry.kind === 'SECRET' ? null : entry.value,
    }));
  }

  /**
   * Internal helper: returns the merged variable set for a service with REAL values
   * (no redaction). Used by Pulumi integration, workflow generator, etc.
   *
   * Service-scoped variables override env-scoped variables on the same key.
   */
  public async resolveForServiceInternal(serviceId: string): Promise<ResolvedVariableEntry[]> {
    const service = await this.prismaService.service.findUnique({
      where: { id: serviceId },
      select: { id: true, environmentId: true },
    });
    if (!service) {
      throw Exceptions.notFound(`Service ${serviceId} not found`, ErrorCodes.NOT_FOUND);
    }

    const [envRows, serviceRows] = await Promise.all([
      this.prismaService.environmentVariable.findMany({
        where: { environmentId: service.environmentId },
      }),
      this.prismaService.serviceVariable.findMany({
        where: { serviceId },
      }),
    ]);

    const merged = new Map<string, ResolvedVariableEntry>();
    for (const row of envRows) {
      merged.set(row.key, {
        key: row.key,
        value: this.safeDecrypt(row.encryptedValue, row.key),
        scope: row.scope,
        kind: row.kind,
        source: 'environment',
      });
    }
    for (const row of serviceRows) {
      // Service vars override env vars by key
      merged.set(row.key, {
        key: row.key,
        value: this.safeDecrypt(row.encryptedValue, row.key),
        scope: row.scope,
        kind: row.kind,
        source: 'service',
      });
    }

    return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Returns every BUILD or BOTH-scope variable visible to a service. Used by the
   * GitHub Actions sync (Phase 2.5) to upsert build-time secrets.
   */
  public async resolveBuildVariablesForService(
    serviceId: string,
  ): Promise<ResolvedVariableEntry[]> {
    const all = await this.resolveForServiceInternal(serviceId);
    return all.filter((entry) => entry.scope === 'BUILD' || entry.scope === 'BOTH');
  }

  /**
   * Apply current vault values to the running App Platform app without rebuilding images.
   *
   * Creates a DeploymentBundle (triggeredBy=`variables-apply:<user>`) with one Deployment
   * per service, each reusing the service's most recent SUCCESS imageUri. A single
   * PROVISION job runs Pulumi up — the new env vars land on App Platform, which then
   * restarts the containers in place (~30s, no rebuild).
   *
   * Rejects 400 if any service has no prior SUCCESS deployment (we'd have no image to reuse).
   */
  public async applyVariables(
    envId: string,
    userId: string,
  ): Promise<{ bundleId: string; deploymentCount: number }> {
    const ctx = await this.getEnvContextOrThrow(envId);
    await this.projectsService.assertProjectRole(ctx.projectId, userId, [Role.OWNER, Role.ADMIN]);

    const env = await this.prismaService.environment.findFirst({
      where: { id: envId, deletedAt: null },
      select: {
        id: true,
        configYaml: true,
        configParsed: true,
        services: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            deployments: {
              where: { status: DeploymentStatus.SUCCESS, imageUri: { not: null } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { imageUri: true, commitSha: true, branch: true },
            },
          },
        },
      },
    });
    if (!env || env.services.length === 0) {
      throw Exceptions.badRequest(
        'Environment has no services to apply variables to',
        ErrorCodes.NOT_FOUND,
      );
    }

    const servicesMissingImage = env.services.filter(
      (service) => service.deployments.length === 0 || !service.deployments[0]?.imageUri,
    );
    if (servicesMissingImage.length > 0) {
      throw Exceptions.badRequest(
        `Cannot apply variables — these services have no prior successful deployment: ${servicesMissingImage
          .map((service) => service.name)
          .join(', ')}. Deploy at least once first.`,
        ErrorCodes.DEPLOYMENT_IMAGE_NOT_FOUND,
      );
    }

    const configYaml = this.resolveConfigYamlOrThrow(env.configYaml, env.configParsed);

    const bundle = await this.prismaService.deploymentBundle.create({
      data: {
        environmentId: envId,
        status: DeploymentBundleStatus.IN_PROGRESS,
        triggeredBy: `variables-apply:${userId}`,
        commitSha: null,
        startedAt: new Date(),
        deployments: {
          create: env.services.map((service) => ({
            environmentId: envId,
            serviceId: service.id,
            status: DeploymentStatus.PROVISIONING,
            imageUri: service.deployments[0]!.imageUri,
            commitSha: service.deployments[0]!.commitSha,
            branch: service.deployments[0]!.branch,
            commitMessage: 'Apply variables (no rebuild)',
            triggeredBy: userId,
            startedAt: new Date(),
          })),
        },
      },
      include: { deployments: true },
    });

    const anchor = bundle.deployments[0];
    if (!anchor) {
      throw Exceptions.internalError(
        'Failed to create deployment bundle for apply-variables',
        ErrorCodes.INTERNAL_ERROR,
      );
    }

    await this.infrastructureQueue.add(
      JOB_NAMES.INFRASTRUCTURE.PROVISION,
      {
        deploymentId: anchor.id,
        environmentId: envId,
        imageUri: anchor.imageUri ?? '',
        configYaml,
        bundleId: bundle.id,
      },
      {
        attempts: 1,
        timeout: QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS,
      } as Parameters<Queue<InfraProvisionJobPayload>['add']>[2] & { timeout: number },
    );

    this.logger.log(
      `apply-variables: bundle ${bundle.id} created for env ${envId} (${bundle.deployments.length} services)`,
    );

    return { bundleId: bundle.id, deploymentCount: bundle.deployments.length };
  }

  /** Resolves env.configYaml (preferred) or env.configParsed back to a YAML string. */
  private resolveConfigYamlOrThrow(
    configYaml: string | null,
    configParsed: Prisma.JsonValue | null,
  ): string {
    if (configYaml) return configYaml;
    if (configParsed) {
      const parsed = safeParseLiftoffConfigAny(configParsed);
      if (parsed.success) return yaml.dump(parsed.data);
    }
    throw Exceptions.badRequest(
      'Environment configuration is missing',
      ErrorCodes.CONFIG_MISSING_REQUIRED_FIELDS,
    );
  }

  /**
   * Returns every RUNTIME or BOTH-scope variable visible to a service. Used by
   * the Pulumi integration to fill App Platform env entries.
   */
  public async resolveRuntimeVariablesForService(
    serviceId: string,
  ): Promise<ResolvedVariableEntry[]> {
    const all = await this.resolveForServiceInternal(serviceId);
    return all.filter((entry) => entry.scope === 'RUNTIME' || entry.scope === 'BOTH');
  }

  // ─────────────────────────── internals ───────────────────────────

  private toEnvResponse(row: EnvironmentVariable): VariableResponse {
    return {
      id: row.id,
      key: row.key,
      value: row.kind === 'SECRET' ? null : this.safeDecrypt(row.encryptedValue, row.key),
      scope: row.scope,
      kind: row.kind,
      hasValue: row.encryptedValue.length > 0,
      createdBy: row.createdBy,
      lastRotatedAt: row.lastRotatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toServiceResponse(row: ServiceVariable): VariableResponse {
    return {
      id: row.id,
      key: row.key,
      value: row.kind === 'SECRET' ? null : this.safeDecrypt(row.encryptedValue, row.key),
      scope: row.scope,
      kind: row.kind,
      hasValue: row.encryptedValue.length > 0,
      createdBy: row.createdBy,
      lastRotatedAt: row.lastRotatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private safeDecrypt(encrypted: string, key: string): string {
    try {
      return this.encryptionService.decrypt(encrypted);
    } catch (error) {
      this.logger.error(
        `Failed to decrypt variable ${key} — likely ENCRYPTION_KEY mismatch with what wrote the row`,
      );
      return '';
    }
  }

  private async getEnvContextOrThrow(envId: string): Promise<EnvContext> {
    const env = await this.prismaService.environment.findFirst({
      where: { id: envId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!env) {
      throw Exceptions.notFound('Environment not found', ErrorCodes.ENVIRONMENT_NOT_FOUND);
    }
    return env;
  }

  private async getServiceContextOrThrow(serviceId: string): Promise<ServiceContext> {
    const service = await this.prismaService.service.findFirst({
      where: { id: serviceId, deletedAt: null },
      include: { environment: { select: { projectId: true } } },
    });
    if (!service) {
      throw Exceptions.notFound('Service not found', ErrorCodes.NOT_FOUND);
    }
    return {
      service: { id: service.id, environmentId: service.environmentId },
      projectId: service.environment.projectId,
    };
  }

  private assertValidKey(key: string): void {
    if (!KEY_PATTERN.test(key)) {
      throw Exceptions.badRequest(
        `Variable key "${key}" must match ${KEY_PATTERN.source}`,
        ErrorCodes.VALIDATION_ERROR,
      );
    }
  }

  /**
   * Parses a .env-style payload into {key, value} pairs.
   * - `#` comments and blank lines are skipped
   * - `KEY=value` and `KEY="value with spaces"` both supported
   * - `export KEY=value` is supported (shell-style)
   * - keys that fail the POSIX env-var regex are flagged invalid (not thrown)
   */
  private parseEnvFile(
    content: string,
  ): Array<{ key: string; value: string; invalidReason?: string }> {
    const out: Array<{ key: string; value: string; invalidReason?: string }> = [];
    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // strip leading `export `
      const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;

      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();

      // strip inline comment outside of quotes (best-effort: only when value isn't quoted)
      if (!value.startsWith('"') && !value.startsWith("'")) {
        const hashIdx = value.indexOf(' #');
        if (hashIdx >= 0) value = value.slice(0, hashIdx).trimEnd();
      }

      // unwrap surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!KEY_PATTERN.test(key)) {
        out.push({
          key,
          value,
          invalidReason: `key must match ${KEY_PATTERN.source}`,
        });
        continue;
      }

      out.push({ key, value });
    }

    return out;
  }

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  /** True for BUILD or BOTH scope — these are the ones that need GitHub Actions sync. */
  private touchesBuild(scope: VariableScope): boolean {
    return scope === 'BUILD' || scope === 'BOTH';
  }
}
