import * as digitalocean from '@pulumi/digitalocean';
import * as pulumi from '@pulumi/pulumi';
import { createLiftoffTags, toDigitalOceanTagList } from '../utils/tags';

export interface ManagedRedisArgs {
  name: string;
  region: string;
  size: string;
  version: string;
  projectName: string;
  environmentName: string;
  provider: digitalocean.Provider;
}

/**
 * Provisions a managed Redis (Valkey) cluster in a user DigitalOcean account.
 * Mirrors ManagedPostgres; exposes the connection uri/host/port for bindings.
 */
export class ManagedRedis extends pulumi.ComponentResource {
  public readonly clusterId: pulumi.Output<string>;
  public readonly clusterName: pulumi.Output<string>;
  public readonly host: pulumi.Output<string>;
  public readonly port: pulumi.Output<string>;
  public readonly password: pulumi.Output<string>;
  public readonly uri: pulumi.Output<string>;

  public constructor(name: string, args: ManagedRedisArgs, opts?: pulumi.ComponentResourceOptions) {
    super('liftoff:database:ManagedRedis', name, {}, opts);

    const tags = createLiftoffTags(args.projectName, args.environmentName);
    const tagList = toDigitalOceanTagList(tags);

    const cluster = new digitalocean.DatabaseCluster(
      `${name}-cluster`,
      {
        name: args.name,
        engine: 'redis',
        version: args.version,
        size: args.size,
        nodeCount: 1,
        region: args.region,
        tags: tagList,
      },
      {
        parent: this,
        provider: args.provider,
      },
    );

    this.clusterId = cluster.id;
    this.clusterName = cluster.name;
    this.host = cluster.host;
    this.port = cluster.port.apply((value) => String(value));
    this.password = cluster.password;
    this.uri = cluster.uri;

    this.registerOutputs({
      clusterId: this.clusterId,
      clusterName: this.clusterName,
      host: this.host,
      port: this.port,
      password: this.password,
      uri: this.uri,
      tags,
    });
  }
}
