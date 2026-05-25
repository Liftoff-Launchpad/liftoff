'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface DeploymentRecord {
  id: string;
  environmentId: string;
  status:
    | 'PENDING'
    | 'QUEUED'
    | 'BUILDING'
    | 'PUSHING'
    | 'PROVISIONING'
    | 'DEPLOYING'
    | 'SUCCESS'
    | 'FAILED'
    | 'ROLLING_BACK'
    | 'ROLLED_BACK'
    | 'CANCELLED';
  commitSha: string | null;
  commitMessage: string | null;
  branch: string | null;
  imageUri: string | null;
  buildStrategy: string | null;
  buildRunUrl: string | null;
  buildPlan: unknown | null;
  triggeredBy: string | null;
  endpoint: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentLogRecord {
  id: string;
  deploymentId: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  source: string;
  timestamp: string;
}

export interface DeploymentsListResponse {
  data: DeploymentRecord[];
  total: number;
}

export interface TriggerDeploymentInput {
  imageUri?: string;
  commitSha?: string;
  commitMessage?: string;
  branch?: string;
}

const deploymentsBaseQueryKey = ['deployments'] as const;

/**
 * Fetches paginated deployments for an environment.
 */
export function useDeployments(environmentId: string, page = 1, limit = 20) {
  return useQuery({
    queryKey: [...deploymentsBaseQueryKey, environmentId, page, limit],
    enabled: Boolean(environmentId),
    queryFn: async () => {
      const response = await apiClient.get<DeploymentsListResponse>(
        `/environments/${environmentId}/deployments`,
        { params: { page, limit } },
      );
      return response.data;
    },
  });
}

/**
 * Fetches one deployment by ID.
 */
export function useDeployment(environmentId: string, deploymentId: string) {
  return useQuery({
    queryKey: [...deploymentsBaseQueryKey, environmentId, deploymentId],
    enabled: Boolean(environmentId && deploymentId),
    queryFn: async () => {
      const response = await apiClient.get<DeploymentRecord>(
        `/environments/${environmentId}/deployments/${deploymentId}`,
      );
      return response.data;
    },
  });
}

/**
 * Fetches persisted deployment logs.
 */
export function useDeploymentLogs(environmentId: string, deploymentId: string) {
  return useQuery({
    queryKey: [...deploymentsBaseQueryKey, environmentId, deploymentId, 'logs'],
    enabled: Boolean(environmentId && deploymentId),
    queryFn: async () => {
      const response = await apiClient.get<DeploymentLogRecord[]>(
        `/environments/${environmentId}/deployments/${deploymentId}/logs`,
      );
      return response.data;
    },
  });
}

/**
 * Triggers a deployment for an environment.
 */
export function useTriggerDeployment(environmentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload?: TriggerDeploymentInput) => {
      const response = await apiClient.post<DeploymentRecord>(
        `/environments/${environmentId}/deployments`,
        payload ?? {},
      );
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...deploymentsBaseQueryKey, environmentId] });
    },
  });
}

/**
 * Queues rollback to a target deployment.
 */
export function useRollbackDeployment(environmentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetDeploymentId: string) => {
      const response = await apiClient.post<DeploymentRecord>(
        `/environments/${environmentId}/deployments/${targetDeploymentId}/rollback`,
      );
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...deploymentsBaseQueryKey, environmentId] });
    },
  });
}

/**
 * Cancels a queued or pending deployment.
 */
export function useCancelDeployment(environmentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deploymentId: string) => {
      const response = await apiClient.post<DeploymentRecord>(
        `/environments/${environmentId}/deployments/${deploymentId}/cancel`,
      );
      return response.data;
    },
    onSuccess: async (_, deploymentId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...deploymentsBaseQueryKey, environmentId] }),
        queryClient.invalidateQueries({
          queryKey: [...deploymentsBaseQueryKey, environmentId, deploymentId],
        }),
      ]);
    },
  });
}
