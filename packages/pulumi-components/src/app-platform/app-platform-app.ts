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
  clusterName: pulumi.Input<string>;
  dbName: pulumi.Input<string>;
  dbUser: pulumi.Input<string>;
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
  /** Optional HTTP healthcheck path; if omitted, App Platform falls back to TCP probe. */
  healthCheckPath?: string;
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
  database?: AppPlatformDatabaseArgs;
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

    const serviceEntries = args.services.map((service) =>
      this.toServiceSpec(service, args.projectName, args.environmentName),
    );

    const app = new digitalocean.App(
      `${name}-app`,
      {
        spec: {
          name: appName,
          region: args.region,
          services: serviceEntries,
          ...(args.database
            ? {
                databases: [
                  {
                    name: 'database',
                    clusterName: args.database.clusterName,
                    dbName: args.database.dbName,
                    dbUser: args.database.dbUser,
                    engine: 'PG',
                    production: true,
                  },
                ],
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
      ...(service.healthCheckPath
        ? { healthCheck: { httpPath: service.healthCheckPath } }
        : {}),
      ...(service.routes.length > 0 ? { routes: service.routes } : {}),
      envs: this.buildServiceEnvs(service.variables, projectName, environmentName),
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
    projectName: string,
    environmentName: string,
  ): digitalocean.types.input.AppSpecServiceEnv[] {
    // Liftoff-managed metadata vars — auto-injected so apps can self-identify in
    // logs/error reporting without hard-coding. User-defined variables of the
    // same name (rare) override these because the resolver de-dupes on key.
    const liftoffMeta = new Map<string, digitalocean.types.input.AppSpecServiceEnv>([
      ['LIFTOFF_PROJECT', { key: 'LIFTOFF_PROJECT', value: projectName, scope: 'RUN_TIME', type: 'GENERAL' }],
      ['LIFTOFF_ENVIRONMENT', { key: 'LIFTOFF_ENVIRONMENT', value: environmentName, scope: 'RUN_TIME', type: 'GENERAL' }],
    ]);

    for (const variable of variables) {
      liftoffMeta.set(variable.key, {
        key: variable.key,
        value: variable.value,
        scope: 'RUN_TIME',
        type: variable.kind === 'secret' ? 'SECRET' : 'GENERAL',
      });
    }

    return Array.from(liftoffMeta.values());
  }
}
