import type { LiftoffConfigV2 } from '@liftoff/shared';

export type PulumiLogLevel = 'info' | 'warn' | 'error';

/**
 * Args passed from the API into the Pulumi subprocess that drives
 * `createAppPlatformStack`. Mirrors the type in
 * `packages/pulumi-components/src/stacks/app-platform-stack.ts`.
 */
export interface AppPlatformStackArgs {
  projectName: string;
  projectId: string;
  environmentName: string;
  environmentId: string;
  doRegion: string;
  doToken: string;
  /**
   * v2 config — multi-service. Callers must promote v1 via `promoteV1ToV2` first.
   */
  config: LiftoffConfigV2;
  /**
   * Map of `service.name` → fully-qualified DOCR image URI. Every service in
   * `config.services` must have a matching entry. Phase 1 usually has length 1.
   */
  serviceImages: Record<string, string>;
}

export interface PulumiStackOutputs {
  appUrl: string;
  appId: string;
  repositoryUrl: string;
  dbClusterName?: string;
  dbUri?: string;
  bucketName?: string;
  bucketEndpoint?: string;
}

export interface PulumiResourceProgress {
  resourceType: string;
  resourceName: string;
  action: string;
  status: 'started' | 'completed';
}

export interface PulumiRunOptions {
  stackName: string;
  doToken: string;
  args: AppPlatformStackArgs;
  onLog?: (line: string, level: PulumiLogLevel) => void;
  onResourceProgress?: (progress: PulumiResourceProgress) => void;
}

export interface PulumiRunResult {
  success: boolean;
  outputs: Partial<PulumiStackOutputs>;
  error?: string;
}

export interface PulumiPreviewResult {
  success: boolean;
  changeSummary: Record<string, number>;
  error?: string;
}
