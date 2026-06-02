import * as digitalocean from '@pulumi/digitalocean';
import * as pulumi from '@pulumi/pulumi';
import { toKebabCase, truncateKebabCase } from '../utils/naming';
import { createLiftoffTags } from '../utils/tags';

type DocrImageReference = {
  registry: string;
  repository: string;
  tag: string;
};

export interface AppPlatformDatabaseArgs {
  /** Unique name within the App's databases[] block. */
  name: string;
  clusterName: pulumi.Input<string>;
  /** App Platform engine code. PG for Postgres, REDIS for Redis/Valkey. */
  engine: 'PG' | 'REDIS';
  dbName?: pulumi.Input<string>;
  dbUser?: pulumi.Input<string>;
}

/**
 * An env var injected into a service from a graph edge (Phase B). The value is a
 * live `pulumi.Input` resolved from the source resource's outputs (e.g. a managed
 * DB connection uri), so secrets never pass through the API/DB.
 */
export interface AppPlatformBindingEnv {
  key: string;
  value: pulumi.Input<string>;
  /** Emit as App Platform SECRET (encrypted) vs GENERAL. */
  secret: boolean;
}

/**
 * One App Platform component within the env's single DO `App`. Phase 1 ships
 * `kind: 'service'`; workers/jobs/static_sites are reserved for Phase 5.
 */
export interface AppPlatformServiceSpec {
  /** Unique within the env's App spec; becomes the App Platform component name. */
  name: string;
  /** Component type. Phase 1: must be 'service'. */
  kind: 'service' | 'worker' | 'job' | 'static_site';
  /** Fully-qualified DOCR image URI to deploy. */
  imageUri: string;
  /** HTTP port the container listens on. App Platform sets PORT=<this> at runtime. */
  httpPort: number;
  instanceSizeSlug: string;
  instanceCount: number;
  /** Public route paths served by this service. At least one required for kind='service'. */
  routes: Array<{ path: string }>;
  /**
   * Runtime variables resolved from the vault (P2.2/P2.3) — merged env-scoped +
   * service-scoped + service overrides. `kind: 'secret'` → emitted as App
   * Platform `SECRET` type (DO encrypts on its side); `kind: 'plain'` → `GENERAL` type.
   */
  variables: AppPlatformVariable[];
  /**
   * Env vars auto-injected from graph edges (resource bindings / service links).
   * Lower precedence than `variables` — a user var of the same key wins.
   */
  bindings?: AppPlatformBindingEnv[];
  /** Optional HTTP healthcheck path; if omitted, App Platform falls back to TCP probe. */
  healthCheckPath?: string;
  /**
   * Start command override. Set as App Platform `run_command` so it works for
   * both Dockerfile and Nixpacks images. Essential for services whose image has
   * no default start (e.g. a Node repo with no `start` script).
   */
  command?: string;
}

/**
 * One resolved variable destined for App Platform's `envs[]` array on a service.
 * Values are plaintext at this point — they came from the encrypted vault and
 * App Platform re-encrypts SECRET entries on its side.
 */
export interface AppPlatformVariable {
  key: string;
  value: string;
  kind: 'plain' | 'secret';
}

export interface AppPlatformAppArgs {
  /** Human-friendly App Platform app name (auto-truncated to App Platform's 32 char cap). */
  appName: string;
  projectName: string;
  environmentName: string;
  region: string;
  /** One spec entry per Service row in the env. Phase 1 typically length 1. */
  services: AppPlatformServiceSpec[];
  /**
   * Managed databases (Postgres/Redis) to attach to the App. Attaching them adds
   * the App as a trusted source on the cluster firewall so services can connect.
   */
  databases?: AppPlatformDatabaseArgs[];
  provider: digitalocean.Provider;
}

/**
 * Provisions a DigitalOcean App Platform app, with one entry in `services[]`
 * per `AppPlatformServiceSpec` passed in. All services share the App's URL via
 * path-based routing (their `routes[]` paths must be distinct).
 */
export class AppPlatformApp extends pulumi.ComponentResource {
  public readonly appId: pulumi.Output<string>;
  public readonly appUrl: pulumi.Output<string>;
  public readonly defaultIngress: pulumi.Output<string>;

  public constructor(
    name: string,
    args: AppPlatformAppArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('liftoff:app-platform:AppPlatformApp', name, {}, opts);

    if (args.services.length === 0) {
      throw new Error('AppPlatformApp requires at least one service spec');
    }

    const tags = createLiftoffTags(args.projectName, args.environmentName);
    const appName = truncateKebabCase(toKebabCase(args.appName), 32);

    // Partition components by kind: HTTP services (and, for now, jobs/static
    // sites which degrade to services) go in services[]; background workers go
    // in workers[] (no port/routes/healthcheck).
    const workerSpecs = args.services.filter((service) => service.kind === 'worker');
    const serviceSpecs = args.services.filter((service) => service.kind !== 'worker');
    const serviceEntries = serviceSpecs.map((service) =>
      this.toServiceSpec(service, args.projectName, args.environmentName),
    );
    const workerEntries = workerSpecs.map((service) =>
      this.toWorkerSpec(service, args.projectName, args.environmentName),
    );

    const app = new digitalocean.App(
      `${name}-app`,
      {
        spec: {
          name: appName,
          region: args.region,
          ...(serviceEntries.length > 0 ? { services: serviceEntries } : {}),
          ...(workerEntries.length > 0 ? { workers: workerEntries } : {}),
          ...(args.databases && args.databases.length > 0
            ? {
                databases: args.databases.map((database) => ({
                  name: database.name,
                  clusterName: database.clusterName,
                  engine: database.engine,
                  production: true,
                  ...(database.dbName ? { dbName: database.dbName } : {}),
                  ...(database.dbUser ? { dbUser: database.dbUser } : {}),
                })),
              }
            : {}),
        },
      },
      {
        parent: this,
        provider: args.provider,
      },
    );

    this.appId = app.id;
    this.appUrl = app.liveUrl;
    this.defaultIngress = app.defaultIngress;

    this.registerOutputs({
      appId: this.appId,
      appUrl: this.appUrl,
      defaultIngress: this.defaultIngress,
      tags,
    });
  }

  private toServiceSpec(
    service: AppPlatformServiceSpec,
    projectName: string,
    environmentName: string,
  ): digitalocean.types.input.AppSpecService {
    const parsedImage = this.parseDocrImageUri(service.imageUri);
    // Service-component name on App Platform must be ≤32 chars; include the
    // Liftoff service name (already kebab) plus an env disambiguator so the
    // same service name across envs doesn't collide.
    const componentName = truncateKebabCase(
      toKebabCase(`${service.name}-${environmentName}`),
      32,
    );

    return {
      name: componentName,
      image: {
        registry: parsedImage.registry,
        registryType: 'DOCR',
        repository: parsedImage.repository,
        tag: parsedImage.tag,
      },
      httpPort: service.httpPort,
      instanceCount: service.instanceCount,
      instanceSizeSlug: service.instanceSizeSlug,
      ...(service.command ? { runCommand: service.command } : {}),
      ...(service.healthCheckPath
        ? { healthCheck: { httpPath: service.healthCheckPath } }
        : {}),
      ...(service.routes.length > 0 ? { routes: service.routes } : {}),
      envs: this.buildServiceEnvs(
        service.variables,
        service.bindings ?? [],
        projectName,
        environmentName,
      ),
    };
  }

  /**
   * Maps a worker-kind spec to an App Platform `workers[]` entry — a long-running
   * non-HTTP process. No port / routes / healthcheck; a runCommand is typical.
   */
  private toWorkerSpec(
    service: AppPlatformServiceSpec,
    projectName: string,
    environmentName: string,
  ): digitalocean.types.input.AppSpecWorker {
    const parsedImage = this.parseDocrImageUri(service.imageUri);
    const componentName = truncateKebabCase(
      toKebabCase(`${service.name}-${environmentName}`),
      32,
    );

    return {
      name: componentName,
      image: {
        registry: parsedImage.registry,
        registryType: 'DOCR',
        repository: parsedImage.repository,
        tag: parsedImage.tag,
      },
      instanceCount: service.instanceCount,
      instanceSizeSlug: service.instanceSizeSlug,
      ...(service.command ? { runCommand: service.command } : {}),
      envs: this.buildServiceEnvs(
        service.variables,
        service.bindings ?? [],
        projectName,
        environmentName,
      ),
    };
  }

  private parseDocrImageUri(imageUri: string): DocrImageReference {
    const match =
      /^registry\.digitalocean\.com\/(?<registry>[^/]+)\/(?<repository>.+?)(?::(?<tag>[^:]+))?$/.exec(
        imageUri,
      );

    if (!match?.groups?.registry || !match.groups.repository) {
      throw new Error(
        `Invalid image URI "${imageUri}". Expected registry.digitalocean.com/{registry}/{repository}:{tag}`,
      );
    }

    return {
      registry: match.groups.registry,
      repository: match.groups.repository,
      tag: match.groups.tag ?? 'latest',
    };
  }

  private buildServiceEnvs(
    variables: AppPlatformVariable[],
    bindings: AppPlatformBindingEnv[],
    projectName: string,
    environmentName: string,
  ): digitalocean.types.input.AppSpecServiceEnv[] {
    // Precedence (lowest -> highest): Liftoff metadata < edge bindings < user vault
    // vars. A Map keyed by env name means later sets win, so a user-set DATABASE_URL
    // overrides the binding-injected one.
    const envByKey = new Map<string, digitalocean.types.input.AppSpecServiceEnv>([
      ['LIFTOFF_PROJECT', { key: 'LIFTOFF_PROJECT', value: projectName, scope: 'RUN_TIME', type: 'GENERAL' }],
      ['LIFTOFF_ENVIRONMENT', { key: 'LIFTOFF_ENVIRONMENT', value: environmentName, scope: 'RUN_TIME', type: 'GENERAL' }],
    ]);

    for (const binding of bindings) {
      envByKey.set(binding.key, {
        key: binding.key,
        value: binding.value,
        scope: 'RUN_TIME',
        type: binding.secret ? 'SECRET' : 'GENERAL',
      });
    }

    for (const variable of variables) {
      envByKey.set(variable.key, {
        key: variable.key,
        value: variable.value,
        scope: 'RUN_TIME',
        type: variable.kind === 'secret' ? 'SECRET' : 'GENERAL',
      });
    }

    return Array.from(envByKey.values());
  }
}
