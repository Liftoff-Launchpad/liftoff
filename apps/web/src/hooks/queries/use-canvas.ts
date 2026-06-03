import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { type DeploymentStatusType } from '@liftoff/shared';

export interface CanvasNode {
  id: string;
  type: 'service' | 'database' | 'redis' | 'storage';
  position: { x: number; y: number };
  data: {
    label: string;
    environmentId: string;
    serviceName?: string;
    endpoint?: string;
    imageUri?: string;
    region?: string;
    instanceSize?: string;
    status?: DeploymentStatusType;
    databaseEngine?: 'postgres' | 'redis';
    hostname?: string;
    port?: number;
    bucketName?: string;
    outputs?: Record<string, string>;
    lastDeployTime?: string;
    buildStrategy?: string;
    runtimeSummary?: string;
    command?: string | null;
    // Resource-node fields (database/redis/storage nodes backed by Resource rows).
    resourceId?: string;
    resourceKind?: 'POSTGRES' | 'REDIS' | 'SPACES_BUCKET';
    resourceStatus?: 'DRAFT' | 'PROVISIONING' | 'ACTIVE' | 'FAILED' | 'DESTROYING';
    resourceConfig?: Record<string, unknown>;
    isStaged?: boolean;
  };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  /** Env vars this edge auto-injects into the target service on deploy. */
  injectedVars?: string[];
  /** Short edge label, e.g. "DATABASE_URL" or "DATABASE_URL +2". */
  label?: string;
}

export interface CanvasState {
  projectId: string;
  projectName: string;
  hasConnectedRepo: boolean;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface AutoSetupInput {
  githubRepoId: number;
  fullName: string;
  branch: string;
  doAccountId?: string;
  environmentId?: string;
}

export interface AutoSetupResult {
  projectId: string;
  environmentId: string;
  deploymentId: string;
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

const canvasQueryKey = ['canvas'] as const;

/**
 * Fetches canvas state for a project.
 */
export function useCanvas(projectId: string) {
  return useQuery({
    queryKey: [...canvasQueryKey, projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const response = await apiClient.get<CanvasState>(`/projects/${projectId}/canvas`);
      return response.data;
    },
  });
}

/**
 * Triggers auto-setup (connects repo + triggers first deploy).
 */
export function useAutoSetup(projectId: string) {
  return useMutation({
    mutationFn: async (input: AutoSetupInput) => {
      const response = await apiClient.post<AutoSetupResult>(
        `/projects/${projectId}/canvas/auto-setup`,
        input,
      );
      return response.data;
    },
  });
}

/**
 * Saves canvas node positions (debounced externally).
 */
export function useSaveCanvasLayout(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (nodes: NodePosition[]) => {
      await apiClient.patch(`/projects/${projectId}/canvas/layout`, { nodes });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...canvasQueryKey, projectId] });
    },
  });
}
