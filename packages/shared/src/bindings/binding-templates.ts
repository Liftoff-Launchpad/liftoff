/**
 * Interactive-graph binding engine (Phase B).
 *
 * Edges on the canvas (Connection rows) become auto-injected env vars at deploy
 * time. The compiler (API) turns Resource + Connection rows into the plain
 * `ResourceSpec[]` / `BindingSpec[]` descriptors below, which are serialized into
 * the Pulumi program. The program provisions the resources and resolves each
 * binding's vars from the live resource outputs — so secrets (DB uri/password)
 * never round-trip through the API or DB.
 */

/** Resource kinds as the Pulumi stack understands them (lowercase). */
export type ResourceKindSpec = 'postgres' | 'redis' | 'spaces';

/** A provisionable resource descriptor passed to the Pulumi program. */
export interface ResourceSpec {
  /** Resource.name — stable handle and Pulumi logical-resource name. */
  name: string;
  kind: ResourceKindSpec;
  /** Engine version (pg: "15", redis: "7"). Ignored for spaces. */
  version?: string;
  /** DO size slug (db clusters). Ignored for spaces. */
  size?: string;
}

/**
 * A resolved graph edge passed to the Pulumi program. Tells it which env vars to
 * inject into `targetServiceName`, mapping each env var to an output key on the
 * source resource (resource binding) — or to the source service's internal URL
 * (service link, resolved by the app component).
 */
export interface BindingSpec {
  kind: 'resource' | 'service_link';
  /** Set for kind='resource'. References a ResourceSpec.name. */
  sourceResourceName?: string;
  /** Set for kind='service_link'. References a service name in the env. */
  sourceServiceName?: string;
  /** Always a service name — the consumer. */
  targetServiceName: string;
  /**
   * envVarName -> output key on the source resource (e.g. { DATABASE_URL: 'uri' }).
   * For service_link the value is the sentinel SERVICE_LINK_URL_TOKEN; the app
   * component substitutes the source service's internal address.
   */
  vars: Record<string, string>;
  /** Subset of `vars` keys to emit as App Platform SECRET (vs GENERAL). */
  secretVars: string[];
}

/** Sentinel output-key for a service link's injected URL var. */
export const SERVICE_LINK_URL_TOKEN = '__internal_url__';

/**
 * Per-kind env-var templates. `default` is always injected; `expanded` keys are
 * opt-in via Connection.injectConfig.include. Output keys MUST match the Pulumi
 * component outputs (ManagedPostgres/ManagedRedis/SpacesBucket).
 */
export const RESOURCE_BINDING_TEMPLATES: Record<
  ResourceKindSpec,
  { default: Record<string, string>; expanded: Record<string, string>; secret: string[] }
> = {
  postgres: {
    default: { DATABASE_URL: 'uri' },
    expanded: {
      PGHOST: 'host',
      PGPORT: 'port',
      PGUSER: 'username',
      PGPASSWORD: 'password',
      PGDATABASE: 'database',
    },
    secret: ['DATABASE_URL', 'PGPASSWORD'],
  },
  redis: {
    default: { REDIS_URL: 'uri' },
    expanded: { REDIS_HOST: 'host', REDIS_PORT: 'port' },
    secret: ['REDIS_URL'],
  },
  spaces: {
    // Bucket identity only — account-level Spaces access keys are user-provided
    // vault vars, never auto-injected from the bucket.
    default: { SPACES_BUCKET: 'bucketName', SPACES_ENDPOINT: 'endpoint', SPACES_REGION: 'region' },
    expanded: {},
    secret: [],
  },
};

/** Maps the Prisma Resource.kind enum to the lowercase spec kind. */
export function resourceKindToSpec(
  kind: 'POSTGRES' | 'REDIS' | 'SPACES_BUCKET',
): ResourceKindSpec {
  if (kind === 'POSTGRES') return 'postgres';
  if (kind === 'REDIS') return 'redis';
  return 'spaces';
}

/** Default engine version per kind when the resource config doesn't specify one. */
export const DEFAULT_RESOURCE_VERSION: Record<ResourceKindSpec, string | undefined> = {
  postgres: '15',
  redis: '7',
  spaces: undefined,
};

/** Default DO size slug per kind for managed database clusters. */
export const DEFAULT_RESOURCE_SIZE: Record<ResourceKindSpec, string | undefined> = {
  postgres: 'db-s-1vcpu-1gb',
  redis: 'db-s-1vcpu-1gb',
  spaces: undefined,
};

/**
 * Optional per-edge override stored on Connection.injectConfig.
 *   include: expanded var keys to add (e.g. ["PGHOST","PGPORT"]).
 *   rename:  { DATABASE_URL: "DB_URL" } — rename injected vars.
 */
export interface InjectConfig {
  include?: string[];
  rename?: Record<string, string>;
}

/**
 * Builds the final (envVarName -> outputKey) map + secret list for a resource
 * binding, applying the kind template plus the optional injectConfig override.
 */
export function resolveResourceBindingVars(
  kind: ResourceKindSpec,
  injectConfig?: InjectConfig | null,
): { vars: Record<string, string>; secretVars: string[] } {
  const template = RESOURCE_BINDING_TEMPLATES[kind];
  const merged: Record<string, string> = { ...template.default };

  // Opt-in expanded vars.
  for (const key of injectConfig?.include ?? []) {
    if (template.expanded[key]) {
      merged[key] = template.expanded[key];
    }
  }

  // Apply renames (envVarName -> newName), preserving secret classification.
  const rename = injectConfig?.rename ?? {};
  const vars: Record<string, string> = {};
  const secretVars: string[] = [];
  for (const [envName, outputKey] of Object.entries(merged)) {
    const finalName = rename[envName] ?? envName;
    vars[finalName] = outputKey;
    if (template.secret.includes(envName)) {
      secretVars.push(finalName);
    }
  }

  return { vars, secretVars };
}
