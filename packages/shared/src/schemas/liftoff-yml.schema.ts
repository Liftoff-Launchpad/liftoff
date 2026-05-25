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
 * Parses and validates a raw liftoff.yml payload.
 */
export function parseLiftoffConfig(raw: unknown): LiftoffConfig {
  return LiftoffConfigSchema.parse(raw);
}

/**
 * Safely parses a raw liftoff.yml payload and returns either typed data or issues.
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
