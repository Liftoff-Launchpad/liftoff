import { Injectable } from '@nestjs/common';
import * as yaml from 'js-yaml';
import type {
  PipelineNode,
  PipelineEdge,
  PipelineValidationError,
  CompilePipelineResult,
  PipelineNodeType,
} from '@liftoff/shared';
import { safeParseLiftoffConfig, LiftoffConfig } from '@liftoff/shared';

interface ResolvedApp {
  nodeId: string;
  name: string;
  port: number;
  instanceSize: string;
  replicas: number;
  healthCheckPath: string;
  region: string;
  env: Record<string, string>;
  secrets: string[];
  domain?: string;
  databaseEnabled: boolean;
  databaseSize: string;
  databaseVersion: string;
  storageEnabled: boolean;
  buildStrategy: 'auto' | 'dockerfile' | 'nixpacks';
  dockerfilePath: string;
  buildContext: string;
}

const TRIGGER_TYPES: PipelineNodeType[] = ['GitHubPushTrigger', 'ManualTrigger', 'ScheduleTrigger'];
const BUILD_TYPES: PipelineNodeType[] = ['DockerBuild', 'AutoDetectBuild'];
const SERVICE_TYPES: PipelineNodeType[] = ['AppService'];
const INFRA_TYPES: PipelineNodeType[] = ['PostgresDatabase', 'SpacesBucket'];
const CONFIG_TYPES: PipelineNodeType[] = ['EnvVars', 'Secret', 'CustomDomain'];

/**
 * Compiles a React Flow pipeline graph into a LiftoffConfig object.
 */
@Injectable()
export class PipelineCompilerService {
  /**
   * Validates graph structure and returns errors with node IDs.
   */
  public validate(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineValidationError[] {
    const errors: PipelineValidationError[] = [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const triggers = nodes.filter((n) => TRIGGER_TYPES.includes(n.type));
    const builds = nodes.filter((n) => BUILD_TYPES.includes(n.type));
    const apps = nodes.filter((n) => SERVICE_TYPES.includes(n.type));

    if (apps.length === 0 && nodes.length > 0) {
      errors.push({ nodeId: '', field: 'graph', message: 'Pipeline must contain at least one App Service node' });
    }

    for (const app of apps) {
      const name = app.data['name'] as string | undefined;
      if (!name || name.length === 0) {
        errors.push({ nodeId: app.id, field: 'name', message: 'App service name is required' });
      } else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        errors.push({ nodeId: app.id, field: 'name', message: 'Name must contain lowercase letters, numbers, or hyphens' });
      }

      const port = app.data['port'] as number | undefined;
      if (!port || port < 1 || port > 65535) {
        errors.push({ nodeId: app.id, field: 'port', message: 'Port must be between 1 and 65535' });
      }
    }

    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);

      if (!source || !target) {
        errors.push({ nodeId: edge.source, field: 'edge', message: 'Edge references a non-existent node' });
        continue;
      }

      if (TRIGGER_TYPES.includes(source.type) && !BUILD_TYPES.includes(target.type)) {
        errors.push({ nodeId: source.id, field: 'edge', message: 'Trigger nodes must connect to build nodes' });
      }

      if (BUILD_TYPES.includes(source.type) && !SERVICE_TYPES.includes(target.type)) {
        errors.push({ nodeId: source.id, field: 'edge', message: 'Build nodes must connect to app service nodes' });
      }
    }

    return errors;
  }

  /**
   * Compiles graph nodes and edges into a LiftoffConfig + YAML string.
   */
  public compile(nodes: PipelineNode[], edges: PipelineEdge[]): CompilePipelineResult {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const apps = nodes.filter((n) => SERVICE_TYPES.includes(n.type));

    if (apps.length === 0) {
      return {
        yaml: '',
        config: {},
        isValid: false,
        validationErrors: [{ nodeId: '', field: 'graph', message: 'No app service node found' }],
      };
    }

    const appNode = apps[0]!;
    const resolved = this.resolveApp(appNode, nodes, edges, nodeMap);
    const rawConfig = this.buildConfig(resolved);

    const parseResult = safeParseLiftoffConfig(rawConfig);

    if (!parseResult.success) {
      const validationErrors: PipelineValidationError[] = parseResult.errors.map((issue) => ({
        nodeId: appNode.id,
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return {
        yaml: '',
        config: rawConfig,
        isValid: false,
        validationErrors,
      };
    }

    const yamlStr = yaml.dump(parseResult.data, { lineWidth: 120, noRefs: true });

    return {
      yaml: yamlStr,
      config: parseResult.data as unknown as Record<string, unknown>,
      isValid: true,
      validationErrors: [],
    };
  }

  private resolveApp(
    appNode: PipelineNode,
    nodes: PipelineNode[],
    edges: PipelineEdge[],
    nodeMap: Map<string, PipelineNode>,
  ): ResolvedApp {
    const resolved: ResolvedApp = {
      nodeId: appNode.id,
      name: (appNode.data['name'] as string) || 'my-app',
      port: (appNode.data['port'] as number) || 3000,
      instanceSize: (appNode.data['instanceSize'] as string) || 'apps-s-1vcpu-0.5gb',
      replicas: (appNode.data['replicas'] as number) || 1,
      healthCheckPath: (appNode.data['healthCheckPath'] as string) || '/health',
      region: (appNode.data['region'] as string) || 'nyc3',
      env: {},
      secrets: [],
      databaseEnabled: false,
      databaseSize: 'db-s-1vcpu-1gb',
      databaseVersion: '15',
      storageEnabled: false,
      buildStrategy: 'auto',
      dockerfilePath: 'Dockerfile',
      buildContext: '.',
    };

    const incomingEdges = edges.filter((e) => e.target === appNode.id);

    for (const edge of incomingEdges) {
      const source = nodeMap.get(edge.source);
      if (!source) continue;

      switch (source.type) {
        case 'PostgresDatabase':
          resolved.databaseEnabled = true;
          if (source.data['size']) resolved.databaseSize = source.data['size'] as string;
          if (source.data['version']) resolved.databaseVersion = source.data['version'] as string;
          break;

        case 'SpacesBucket':
          resolved.storageEnabled = true;
          if (source.data['region']) resolved.region = source.data['region'] as string;
          break;

        case 'EnvVars': {
          const vars = source.data['variables'] as Record<string, string> | undefined;
          if (vars) {
            Object.assign(resolved.env, vars);
          }
          break;
        }

        case 'Secret': {
          const secretName = source.data['name'] as string | undefined;
          if (secretName) {
            resolved.secrets.push(secretName);
          }
          break;
        }

        case 'CustomDomain': {
          const domainName = source.data['domain'] as string | undefined;
          if (domainName) {
            resolved.domain = domainName;
          }
          break;
        }

        case 'DockerBuild':
          resolved.buildStrategy = 'dockerfile';
          if (source.data['dockerfilePath']) resolved.dockerfilePath = source.data['dockerfilePath'] as string;
          if (source.data['context']) resolved.buildContext = source.data['context'] as string;
          break;

        case 'AutoDetectBuild':
          resolved.buildStrategy = 'auto';
          break;
      }
    }

    return resolved;
  }

  private buildConfig(app: ResolvedApp): Record<string, unknown> {
    const config: Record<string, unknown> = {
      version: '1.0',
      service: {
        name: app.name,
        type: 'app',
        region: app.region,
      },
      runtime: {
        instance_size: app.instanceSize,
        replicas: app.replicas,
        port: app.port,
      },
      build: {
        strategy: app.buildStrategy,
        dockerfile_path: app.dockerfilePath,
        context: app.buildContext,
      },
      database: {
        enabled: app.databaseEnabled,
        engine: 'postgres',
        version: app.databaseVersion,
        size: app.databaseSize,
      },
      storage: {
        enabled: app.storageEnabled,
      },
      healthcheck: {
        path: app.healthCheckPath,
      },
    };

    if (Object.keys(app.env).length > 0) {
      config['env'] = app.env;
    }

    if (app.secrets.length > 0) {
      config['secrets'] = app.secrets;
    }

    if (app.domain) {
      config['domain'] = { name: app.domain };
    }

    return config;
  }
}
