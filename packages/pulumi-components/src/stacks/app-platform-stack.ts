import type { BindingSpec, LiftoffConfigV2, LiftoffServiceV2, ResourceSpec } from '@liftoff/shared';
import * as digitalocean from '@pulumi/digitalocean';
import * as pulumi from '@pulumi/pulumi';
import {
  AppPlatformApp,
  type AppPlatformBindingEnv,
  type AppPlatformDatabaseArgs,
  type AppPlatformServiceSpec,
  type AppPlatformVariable,
} from '../app-platform/app-platform-app';
import { ManagedPostgres } from '../database/managed-postgres';
import { ManagedRedis } from '../database/managed-redis';
import { DocrRepository } from '../registry/docr-repository';
import { SpacesBucket } from '../storage/spaces-bucket';
import { buildAppName, buildBucketName, toKebabCase, truncateKebabCase } from '../utils/naming';

export interface AppPlatformStackArgs {
  projectName: string;
  projectId: string;
  environmentName: string;
  environmentId: string;
  doRegion: string;
  doToken: string;
  /**
   * LiftoffConfig v2 — multi-service. Callers MUST promote v1 configs before
   * passing in (use `promoteV1ToV2` from `@liftoff/shared`).
   */
  config: LiftoffConfigV2;
  /**
   * Maps each `config.services[].name` → fully-qualified DOCR image URI.
   * Every service in `config.services` must have an entry here.
   */
  serviceImages: Record<string, string>;
  /**
   * Phase 2: maps each `config.services[].name` → resolved runtime variables
   * (vault env-scoped + service-scoped, with service overriding env on shared keys).
   * Pass an empty array for any service with no variables; omit a service key
   * entirely and only the auto-injected LIFTOFF_* metadata vars will appear.
   */
  serviceVariables?: Record<string, AppPlatformVariable[]>;
  /**
   * Phase B: managed resources to provision (Postgres / Redis / Spaces bucket),
   * compiled from the env's Resource rows. Replaces the legacy
   * `config.database`/`config.storage` flags (which are now ignored).
   */
  resources?: ResourceSpec[];
  /**
   * Phase B: graph edges to resolve into auto-injected service env vars. Each
   * binding's vars are read from the live resource outputs inside this program,
   * so secrets never leave Pulumi.
   */
  bindings?: BindingSpec[];
}

export interface StackOutputs {
  appUrl: pulumi.Output<string>;
  appId: pulumi.Output<string>;
  repositoryUrl: pulumi.Output<string>;
  dbClusterName?: pulumi.Output<string>;
  dbUri?: pulumi.Output<string>;
  bucketName?: pulumi.Output<string>;
  bucketEndpoint?: pulumi.Output<string>;
}

/**
 * Provisions Liftoff's app-platform stack in a user's DigitalOcean account:
 *
 *   - 1× DOCR (registry creds + repo URL) — env-wide, shared across services
 *   - Optional 1× Managed Postgres if `config.database.enabled`
 *   - Optional 1× Spaces Bucket if `config.storage.enabled`
 *   - 1× App Platform App with one `services[]` entry per `config.services` row
 *     (path-based routing across services)
 *
 * The single `digitalocean.Provider` is scoped to the user's token so every
 * resource lands in their account.
 */
export function createAppPlatformStack(args: AppPlatformStackArgs): StackOutputs {
  validateServiceImages(args.config.services, args.serviceImages);

  const provider = new digitalocean.Provider('user-account', {
    token: args.doToken,
  });
  const firstService = args.config.services[0];
  if (!firstService) {
    throw new Error('AppPlatformStack requires at least one service in config.services');
  }
  const registryName = resolveRegistryNameFromImageUri(
    args.serviceImages[firstService.name] ?? '',
  );

  const registry = new DocrRepository(
    'registry',
    {
      projectName: args.projectName,
      environmentName: args.environmentName,
      docrName: registryName,
      provider,
    },
    { provider },
  );

  // ── Provision graph resources (Phase B) ──────────────────────────────────
  // One managed resource per Resource row. Each exposes a non-secret-keyed output
  // map used below to resolve bindings. Postgres/Redis are also attached to the
  // App's databases[] so App Platform adds the App as a trusted firewall source.
  const resourceSpecs = args.resources ?? [];
  const resourceOutputs: Record<string, Record<string, pulumi.Output<string>>> = {};
  const databaseAttachments: AppPlatformDatabaseArgs[] = [];
  let firstPostgres: ManagedPostgres | undefined;
  let firstBucket: SpacesBucket | undefined;

  for (const spec of resourceSpecs) {
    const logical = `resource-${toKebabCase(spec.name)}`;
    const clusterName = truncateKebabCase(
      toKebabCase(`liftoff-${args.projectName}-${args.environmentName}-${spec.name}`),
      63,
    );
    const attachmentName = truncateKebabCase(toKebabCase(spec.name), 32);

    if (spec.kind === 'postgres') {
      const pg = new ManagedPostgres(
        logical,
        {
          name: clusterName,
          region: args.doRegion,
          size: spec.size ?? 'db-s-1vcpu-1gb',
          version: spec.version ?? '15',
          projectName: args.projectName,
          environmentName: args.environmentName,
          provider,
        },
        { provider },
      );
      resourceOutputs[spec.name] = {
        uri: pg.uri,
        host: pg.host,
        port: pg.port,
        username: pg.username,
        password: pg.password,
        database: pg.database,
      };
      databaseAttachments.push({
        name: attachmentName,
        clusterName: pg.clusterName,
        engine: 'PG',
        dbName: pg.database,
        dbUser: pg.username,
      });
      if (!firstPostgres) firstPostgres = pg;
    } else if (spec.kind === 'redis') {
      const redis = new ManagedRedis(
        logical,
        {
          name: clusterName,
          region: args.doRegion,
          size: spec.size ?? 'db-s-1vcpu-1gb',
          version: spec.version ?? '7',
          projectName: args.projectName,
          environmentName: args.environmentName,
          provider,
        },
        { provider },
      );
      resourceOutputs[spec.name] = {
        uri: redis.uri,
        host: redis.host,
        port: redis.port,
        password: redis.password,
      };
      databaseAttachments.push({
        name: attachmentName,
        clusterName: redis.clusterName,
        engine: 'REDIS',
      });
    } else {
      const bucket = new SpacesBucket(
        logical,
        {
          bucketName: buildBucketName(args.projectName, `${args.environmentName}-${spec.name}`),
          region: args.doRegion,
          projectName: args.projectName,
          environmentName: args.environmentName,
          provider,
        },
        { provider },
      );
      resourceOutputs[spec.name] = {
        bucketName: bucket.bucketName,
        endpoint: bucket.endpoint,
        region: pulumi.output(args.doRegion),
      };
      if (!firstBucket) firstBucket = bucket;
    }
  }

  // ── Resolve per-service binding env vars from live resource outputs ──────────
  const bindings = args.bindings ?? [];
  const resolveBindingsForService = (serviceName: string): AppPlatformBindingEnv[] => {
    const resolved: AppPlatformBindingEnv[] = [];
    for (const binding of bindings) {
      if (binding.targetServiceName !== serviceName) continue;

      if (binding.kind === 'resource' && binding.sourceResourceName) {
        const outputs = resourceOutputs[binding.sourceResourceName];
        if (!outputs) continue;
        for (const [envName, outputKey] of Object.entries(binding.vars)) {
          const value = outputs[outputKey];
          if (!value) continue;
          resolved.push({ key: envName, value, secret: binding.secretVars.includes(envName) });
        }
      } else if (binding.kind === 'service_link' && binding.sourceServiceName) {
        const sourceService = args.config.services.find(
          (candidate) => candidate.name === binding.sourceServiceName,
        );
        if (!sourceService) continue;
        // App Platform private networking: a component is reachable inside the App
        // at http://<component-name>:<httpPort>.
        const componentName = truncateKebabCase(
          toKebabCase(`${sourceService.name}-${args.environmentName}`),
          32,
        );
        const internalUrl = `http://${componentName}:${sourceService.runtime.port}`;
        for (const envName of Object.keys(binding.vars)) {
          resolved.push({ key: envName, value: internalUrl, secret: false });
        }
      }
    }
    return resolved;
  };

  const serviceVariables = args.serviceVariables ?? {};
  const serviceSpecs: AppPlatformServiceSpec[] = args.config.services.map((service) =>
    toServiceSpec(
      service,
      args.serviceImages[service.name] ?? '',
      serviceVariables[service.name] ?? [],
      resolveBindingsForService(service.name),
    ),
  );

  const app = new AppPlatformApp(
    'app',
    {
      appName: buildAppName(args.projectName, args.environmentName),
      projectName: args.projectName,
      environmentName: args.environmentName,
      region: args.doRegion,
      services: serviceSpecs,
      databases: databaseAttachments.length > 0 ? databaseAttachments : undefined,
      provider,
    },
    { provider },
  );

  const outputs: StackOutputs = {
    appUrl: app.appUrl,
    appId: app.appId,
    repositoryUrl: registry.repositoryUrl,
    ...(firstPostgres
      ? {
          dbClusterName: firstPostgres.clusterName,
          dbUri: pulumi.secret(firstPostgres.uri),
        }
      : {}),
    ...(firstBucket
      ? {
          bucketName: firstBucket.bucketName,
          bucketEndpoint: firstBucket.endpoint,
        }
      : {}),
  };

  return outputs;
}

function toServiceSpec(
  service: LiftoffServiceV2,
  imageUri: string,
  vaultVariables: AppPlatformVariable[],
  bindings: AppPlatformBindingEnv[],
): AppPlatformServiceSpec {
  const routes =
    service.routes && service.routes.length > 0
      ? service.routes.map((route) => ({ path: route.path }))
      : [{ path: '/' }];

  // Merge liftoff.yml legacy `env`/`secrets` (low priority) with vault values
  // (high priority — they're the explicit user-supplied source of truth in Phase 2+).
  // Vault entries override yaml entries on the same key.
  const merged = new Map<string, AppPlatformVariable>();
  for (const [key, value] of Object.entries(service.env ?? {})) {
    merged.set(key, { key, value, kind: 'plain' });
  }
  for (const secretName of service.secrets ?? []) {
    // Legacy yaml `secrets: [NAME]` only specifies the key — the actual value
    // was meant to be set in App Platform's UI. Phase 2+ stops emitting these
    // when the user has a vault entry; the fallback keeps existing yaml configs working.
    if (!merged.has(secretName)) {
      merged.set(secretName, { key: secretName, value: secretName, kind: 'secret' });
    }
  }
  for (const variable of vaultVariables) {
    merged.set(variable.key, variable);
  }

  return {
    name: service.name,
    kind: service.type,
    imageUri,
    httpPort: service.runtime.port,
    instanceSizeSlug: service.runtime.instance_size,
    instanceCount: service.runtime.replicas,
    routes,
    variables: Array.from(merged.values()),
    bindings,
    healthCheckPath: service.healthcheck?.path,
    command: service.command,
  };
}

function validateServiceImages(
  services: LiftoffConfigV2['services'],
  serviceImages: Record<string, string>,
): void {
  const missing = services
    .map((service) => service.name)
    .filter((name) => !serviceImages[name]);
  if (missing.length > 0) {
    throw new Error(
      `serviceImages is missing entries for: ${missing.join(', ')}. ` +
        'Every service in config.services must have a corresponding image URI.',
    );
  }
}

function resolveRegistryNameFromImageUri(imageUri: string): string {
  const match = /^registry\.digitalocean\.com\/([^/]+)\//.exec(imageUri);
  if (!match?.[1]) {
    throw new Error(
      `Invalid image URI "${imageUri}". Expected registry.digitalocean.com/{registry}/{repository}:{tag}`,
    );
  }

  return match[1];
}
