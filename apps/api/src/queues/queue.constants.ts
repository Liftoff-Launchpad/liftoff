/**
 * Queue names used for BullMQ queue registration.
 */
export const QUEUE_NAMES = {
  DEPLOYMENTS: 'deployments',
  INFRASTRUCTURE: 'infrastructure',
} as const;

/**
 * Job names grouped by queue.
 */
export const JOB_NAMES = {
  DEPLOYMENTS: {
    DEPLOY: 'deploy',
    ROLLBACK: 'rollback',
  },
  INFRASTRUCTURE: {
    PROVISION: 'provision',
    DESTROY: 'destroy',
  },
} as const;

/**
 * Queue timing controls (in milliseconds).
 */
export const QUEUE_TIMEOUTS = {
  DEPLOYMENT_JOB_TIMEOUT_MS: 20 * 60 * 1000,
  ACTIVE_DEPLOYMENT_TIMEOUT_MS: 30 * 60 * 1000,
} as const;

export interface DeployJobPayload {
  deploymentId: string;
  environmentId: string;
  commitSha?: string;
  /**
   * If set, the processor loads the whole DeploymentBundle and applies all
   * per-service images atomically (one updateApp call patching N services).
   * If absent, falls back to single-deployment behaviour.
   */
  bundleId?: string;
}

export interface RollbackJobPayload {
  deploymentId: string;
  targetDeploymentId?: string;
}

export interface InfraProvisionJobPayload {
  deploymentId: string;
  environmentId: string;
  /**
   * Single-image fallback (legacy single-service path). Ignored when bundleId
   * is set — the processor pulls per-service image URIs from the bundle's
   * deployment rows instead.
   */
  imageUri: string;
  configYaml: string;
  bundleId?: string;
}

export interface InfraDestroyJobPayload {
  environmentId: string;
}
