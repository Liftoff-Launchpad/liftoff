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
 * One App Platform component within the env's single DO `App`.
 *   - `service`     → `services[]`     (HTTP, public route)
 *   - `worker`      → `workers[]`      (background, no port/route)
 *   - `job`         → `jobs[]`         (deploy-lifecycle hook; see `jobKind`)
 *   - `static_site` → `services[]`     (served as a lightweight container — DO's
 *     native `static_sites[]` only accepts a git source, not a DOCR image, so an
 *     image-built static site is deployed as a container service)
 */
export interface AppPlatformServiceSpec {
  /** Unique within the env's App spec; becomes the App Platform component name. */
  name: string;
  /** Component type — dispatched to the matching App spec array (see interface doc). */
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
  /**
   * JOB only: when the job runs in the deploy lifecycle. App Platform supports
   * PRE_DEPLOY / POST_DEPLOY / FAILED_DEPLOY. `cron` has no native App Platform
   * scheduler — it's treated as POST_DEPLOY here and carried in liftoff.yml for
   * export; true scheduled execution would need a worker-based scheduler.
   */
  jobKind?: 'cron' | 'pre_deploy' | 'post_deploy' | 'failed_deploy';
  /** JOB only: cron expression (export/record only; not an App Platform primitive). */
  schedule?: string;
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

    // Partition components by kind into the matching App spec arrays. Background
    // workers → workers[]; deploy-lifecycle jobs → jobs[]; HTTP services and
    // image-built static sites → services[] (DO static_sites[] need a git source,
    // not a DOCR image, so an image-built static site runs as a container service).
    const workerSpecs = args.services.filter((service) => service.kind === 'worker');
    const jobSpecs = args.services.filter((service) => service.kind === 'job');
    const serviceSpecs = args.services.filter(
      (service) => service.kind !== 'worker' && service.kind !== 'job',
    );
    const serviceEntries = serviceSpecs.map((service) =>
      this.toServiceSpec(service, args.projectName, args.environmentName),
    );
    // Build app-level ingress rules from the HTTP services' routes. App Platform
    // treats legacy component-level `routes[]` and the modern top-level
    // `spec.ingress.rules[]` as mutually exclusive, so we emit ONLY ingress here
    // (component routes are dropped in toServiceSpec). Workers/jobs are excluded
    // by construction — serviceSpecs contains only HTTP components.
    const ingressRules = this.buildIngressRules(serviceSpecs, args.environmentName);
    const workerEntries = workerSpecs.map((service) =>
      this.toWorkerSpec(service, args.projectName, args.environmentName),
    );
    const jobEntries = jobSpecs.map((service) =>
      this.toJobSpec(service, args.projectName, args.environmentName),
    );

    const app = new digitalocean.App(
      `${name}-app`,
      {
        spec: {
          name: appName,
          region: args.region,
          ...(serviceEntries.length > 0 ? { services: serviceEntries } : {}),
          ...(ingressRules.length > 0 ? { ingress: { rules: ingressRules } } : {}),
          ...(workerEntries.length > 0 ? { workers: workerEntries } : {}),
          ...(jobEntries.length > 0 ? { jobs: jobEntries } : {}),
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
    const componentName = this.componentName(service, environmentName);

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
      // Routing is emitted at the app level via `spec.ingress.rules[]` (see
      // buildIngressRules). Component-level `routes[]` are deprecated by DO and
      // mutually exclusive with ingress, so they are intentionally NOT set here.
      envs: this.buildServiceEnvs(
        service.variables,
        service.bindings ?? [],
        projectName,
        environmentName,
      ),
    };
  }

  /**
   * Builds app-level `spec.ingress.rules[]` from the HTTP services' route paths.
   * Each route path becomes one rule routing that prefix to the owning component
   * by name. DO evaluates rules top-to-bottom (first prefix match wins), so rules
   * are sorted most-specific-first — longer prefixes before shorter ones — which
   * puts the catch-all `/` last. Only HTTP services are passed in here, so
   * workers/jobs never receive ingress routing.
   */
  private buildIngressRules(
    serviceSpecs: AppPlatformServiceSpec[],
    environmentName: string,
  ): digitalocean.types.input.AppSpecIngressRule[] {
    const rules: digitalocean.types.input.AppSpecIngressRule[] = [];
    for (const service of serviceSpecs) {
      const name = this.componentName(service, environmentName);
      for (const route of service.routes) {
        rules.push({
          match: { path: { prefix: route.path } },
          component: { name },
        });
      }
    }
    // Most-specific (longest prefix) first so a catch-all `/` is matched last.
    return rules.sort(
      (a, b) =>
        (b.match as { path: { prefix: string } }).path.prefix.length -
        (a.match as { path: { prefix: string } }).path.prefix.length,
    );
  }

  /**
   * Component name as it appears in the App spec: the Liftoff service name (already
   * kebab) plus an env disambiguator, kebab-cased and truncated to App Platform's
   * 32-char component-name cap. Shared by every component mapper and the ingress
   * builder so ingress rules reference the exact names emitted on the components.
   */
  private componentName(
    service: AppPlatformServiceSpec,
    environmentName: string,
  ): string {
    return truncateKebabCase(
      toKebabCase(`${service.name}-${environmentName}`),
      32,
    );
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

  /**
   * Maps a job-kind spec to an App Platform `jobs[]` entry — a run-to-completion
   * task tied to the deploy lifecycle. App Platform job `kind` is one of
   * PRE_DEPLOY / POST_DEPLOY / FAILED_DEPLOY (there is no native cron); a Liftoff
   * `cron` jobKind degrades to POST_DEPLOY.
   */
  private toJobSpec(
    service: AppPlatformServiceSpec,
    projectName: string,
    environmentName: string,
  ): digitalocean.types.input.AppSpecJob {
    const parsedImage = this.parseDocrImageUri(service.imageUri);
    const componentName = truncateKebabCase(
      toKebabCase(`${service.name}-${environmentName}`),
      32,
    );

    return {
      name: componentName,
      kind: this.mapJobKind(service.jobKind),
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

  /** Maps a Liftoff jobKind to App Platform's job `kind` enum. */
  private mapJobKind(jobKind: AppPlatformServiceSpec['jobKind']): string {
    switch (jobKind) {
      case 'pre_deploy':
        return 'PRE_DEPLOY';
      case 'failed_deploy':
        return 'FAILED_DEPLOY';
      // App Platform has no native cron scheduler — a cron job runs post-deploy.
      case 'cron':
      case 'post_deploy':
      default:
        return 'POST_DEPLOY';
    }
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
