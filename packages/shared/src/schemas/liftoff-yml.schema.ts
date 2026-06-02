import { z } from 'zod';

const DO_REGIONS = [
  'nyc1',
  'nyc3',
  'sfo2',
  'sfo3',
  'ams3',
  'sgp1',
  'lon1',
  'fra1',
  'tor1',
  'blr1',
  'syd1',
] as const;

const DO_APP_INSTANCE_SIZES = [
  'apps-s-1vcpu-0.5gb',
  'apps-s-1vcpu-1gb',
  'apps-s-2vcpu-4gb',
  'apps-d-1vcpu-0.5gb',
  'apps-d-1vcpu-1gb',
  'apps-d-2vcpu-4gb',
  'apps-d-4vcpu-8gb',
] as const;

const DO_DATABASE_SIZES = [
  'db-s-1vcpu-1gb',
  'db-s-1vcpu-2gb',
  'db-s-2vcpu-4gb',
  'db-s-4vcpu-8gb',
  'db-s-6vcpu-16gb',
  'db-s-8vcpu-32gb',
] as const;

const ServiceSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'service.name must contain lowercase letters, numbers, or hyphens'),
  type: z.literal('app'),
  region: z.enum(DO_REGIONS).default('nyc3'),
});

const RuntimeSchema = z.object({
  instance_size: z.enum(DO_APP_INSTANCE_SIZES).default('apps-s-1vcpu-0.5gb'),
  replicas: z.number().int().min(1).max(10).default(1),
  port: z.number().int().min(1).max(65535),
});

const DatabaseSchema = z.object({
  enabled: z.boolean().default(false),
  engine: z.literal('postgres').default('postgres'),
  version: z.string().default('15'),
  size: z.enum(DO_DATABASE_SIZES).default('db-s-1vcpu-1gb'),
});

const StorageSchema = z.object({
  enabled: z.boolean().default(false),
});

const HealthcheckSchema = z.object({
  path: z.string().startsWith('/').default('/health'),
  interval: z.number().int().min(5).max(300).default(30),
  timeout: z.number().int().min(2).max(60).default(5),
});

const DomainSchema = z.object({
  name: z.string().min(1),
});

const BuildSchema = z.object({
  strategy: z.enum(['auto', 'dockerfile', 'nixpacks']).default('auto'),
  dockerfile_path: z.string().min(1).default('Dockerfile'),
  context: z.string().min(1).default('.'),
});

// ============================================================================
// LiftoffConfig v1 (single-service)
// ============================================================================

export const LiftoffConfigSchema = z.object({
  version: z.literal('1.0'),
  service: ServiceSchema,
  runtime: RuntimeSchema,
  env: z.record(z.string()).optional().default({}),
  secrets: z.array(z.string()).optional().default([]),
  build: BuildSchema.default({}),
  database: DatabaseSchema.default({}),
  storage: StorageSchema.default({}),
  healthcheck: HealthcheckSchema.default({}),
  domain: DomainSchema.optional(),
});

export type LiftoffConfig = z.infer<typeof LiftoffConfigSchema>;

/**
 * Parses and validates a raw liftoff.yml v1 payload.
 */
export function parseLiftoffConfig(raw: unknown): LiftoffConfig {
  return LiftoffConfigSchema.parse(raw);
}

/**
 * Safely parses a raw liftoff.yml v1 payload and returns either typed data or issues.
 */
export function safeParseLiftoffConfig(
  raw: unknown,
): { success: true; data: LiftoffConfig } | { success: false; errors: z.ZodIssue[] } {
  const result = LiftoffConfigSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, errors: result.error.issues };
}

// ============================================================================
// LiftoffConfig v2 (multi-service)
// ============================================================================

const ServiceKindV2Schema = z
  .enum(['service', 'worker', 'job', 'static_site'])
  .default('service');

const RouteSchema = z.object({
  path: z
    .string()
    .startsWith('/', { message: 'route path must start with /' })
    .min(1)
    .max(200),
});

const ServiceV2Schema = z.object({
  /** Unique within the env. Lowercase letters, numbers, and hyphens only. */
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'service name must contain lowercase letters, numbers, or hyphens',
    ),
  /**
   * Component type. Phase 1 only ships `service`; the others are reserved for
   * Phase 5 (workers, cron jobs, native static sites).
   */
  type: ServiceKindV2Schema,
  /**
   * Reference to a `sources[].id` entry. Optional; Phase 1 ignores this because
   * each project has one repo. Becomes meaningful in Phase 4 (multi-repo).
   */
  source: z.string().optional(),
  /** Runtime sizing + port. Mandatory for `service`/`worker`. */
  runtime: RuntimeSchema,
  build: BuildSchema.default({}),
  healthcheck: HealthcheckSchema.optional(),
  /**
   * HTTP paths this service answers. Omit (or empty array) for internal-only
   * services. First service in a fresh env defaults to `[{path: '/'}]`.
   */
  routes: z.array(RouteSchema).optional().default([]),
  env: z.record(z.string()).optional().default({}),
  secrets: z.array(z.string()).optional().default([]),
  /** WORKER/JOB only: override process command. */
  command: z.string().optional(),
  /** JOB only: cron schedule (e.g. "0 3 * * *") + invocation kind. */
  schedule: z.string().optional(),
  jobKind: z
    .enum(['cron', 'pre_deploy', 'post_deploy', 'failed_deploy'])
    .optional(),
});

const SourceSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'source id must be lowercase + hyphens'),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'repository must be in owner/name form'),
  branch: z.string().min(1).default('main'),
});

export const LiftoffConfigV2Schema = z.object({
  version: z.literal('2.0'),
  /**
   * Multi-repo support (Phase 4). Phase 1 ignores this entirely; every service
   * builds from the project's single connected repository.
   */
  sources: z.array(SourceSchema).optional(),
  services: z.array(ServiceV2Schema).min(1, { message: 'at least one service is required' }),
  /** Env-shared resources. Same shape as v1 for low-friction migration. */
  database: DatabaseSchema.default({}),
  storage: StorageSchema.default({}),
  domain: DomainSchema.optional(),
});

export type LiftoffConfigV2 = z.infer<typeof LiftoffConfigV2Schema>;
export type LiftoffServiceV2 = z.infer<typeof ServiceV2Schema>;
export type LiftoffSourceV2 = z.infer<typeof SourceSchema>;

/**
 * Parses and validates a raw liftoff.yml v2 payload.
 */
export function parseLiftoffConfigV2(raw: unknown): LiftoffConfigV2 {
  return LiftoffConfigV2Schema.parse(raw);
}

/**
 * Safely parses a raw liftoff.yml v2 payload.
 */
export function safeParseLiftoffConfigV2(
  raw: unknown,
): { success: true; data: LiftoffConfigV2 } | { success: false; errors: z.ZodIssue[] } {
  const result = LiftoffConfigV2Schema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, errors: result.error.issues };
}

// ============================================================================
// v1 → v2 upgrade path
// ============================================================================

/**
 * Lifts a v1 (single-service) config into the v2 (multi-service) shape.
 * The single v1 `service` block becomes a single entry in v2 `services`,
 * inheriting the env-wide healthcheck and exposing the root path `/`.
 */
export function promoteV1ToV2(v1: LiftoffConfig): LiftoffConfigV2 {
  return {
    version: '2.0',
    services: [
      {
        name: v1.service.name,
        type: 'service',
        runtime: v1.runtime,
        build: v1.build,
        healthcheck: v1.healthcheck,
        routes: [{ path: '/' }],
        env: v1.env,
        secrets: v1.secrets,
      },
    ],
    database: v1.database,
    storage: v1.storage,
    domain: v1.domain,
  };
}

/**
 * Version-agnostic parser. Inspects the raw payload's `version` field and
 * dispatches to the right schema. v1 payloads are always returned promoted to
 * v2 so downstream consumers (Pulumi compiler, workflow generator, canvas)
 * only need to know v2.
 *
 * Note: if no `version` field is present, we treat the payload as v1 for
 * back-compat with config_yaml strings written before the v2 release.
 */
export function safeParseLiftoffConfigAny(
  raw: unknown,
): { success: true; data: LiftoffConfigV2 } | { success: false; errors: z.ZodIssue[] } {
  const detectedVersion = readVersionString(raw);

  if (detectedVersion === '2.0') {
    return safeParseLiftoffConfigV2(raw);
  }

  const v1Result = safeParseLiftoffConfig(raw);
  if (!v1Result.success) {
    return v1Result;
  }

  return { success: true, data: promoteV1ToV2(v1Result.data) };
}

function readVersionString(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const version = (raw as { version?: unknown }).version;
  return typeof version === 'string' ? version : null;
}
