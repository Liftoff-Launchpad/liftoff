'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { apiClient } from '@/lib/api-client';

export interface AvailableRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
}

export interface ConnectedRepository {
  id: string;
  projectId: string;
  githubId: number;
  fullName: string;
  cloneUrl: string;
  branch: string;
  webhookId: number | null;
  webhookStatus: 'active' | 'missing';
  workflowPath: string;
  workflowUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectRepositoryInput {
  githubRepoId: number;
  fullName: string;
  branch: string;
}

const repositoryBaseQueryKey = ['project-repository'] as const;

/**
 * Lists GitHub repositories available to connect for a project.
 */
export function useAvailableRepos(projectId: string) {
  return useQuery({
    queryKey: [...repositoryBaseQueryKey, projectId, 'available'],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const response = await apiClient.get<AvailableRepository[]>(
        `/projects/${projectId}/repository/available`,
      );
      return response.data;
    },
  });
}

/**
 * Returns connected repository for a project, or null if not connected.
 */
export function useConnectedRepo(projectId: string) {
  return useQuery({
    queryKey: [...repositoryBaseQueryKey, projectId, 'connected'],
    enabled: Boolean(projectId),
    queryFn: async () => {
      try {
        const response = await apiClient.get<ConnectedRepository>(`/projects/${projectId}/repository`);
        return response.data;
      } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 404) {
          return null;
        }

        throw error;
      }
    },
  });
}

/**
 * Connects a repository to a project.
 */
export function useConnectRepo(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ConnectRepositoryInput) => {
      const response = await apiClient.post<ConnectedRepository>(
        `/projects/${projectId}/repository`,
        payload,
      );
      return response.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...repositoryBaseQueryKey, projectId, 'connected'] }),
        queryClient.invalidateQueries({ queryKey: [...repositoryBaseQueryKey, projectId, 'available'] }),
      ]);
    },
  });
}

export interface EnvExampleScanResult {
  foundAt: string | null;
  keys: Array<{
    key: string;
    defaultValue: string | null;
    hint: string | null;
  }>;
}

/**
 * Scans the connected repo for `.env.example` (or `.sample` / `.template`).
 * Returns the parsed keys + optional defaults + comment hints so onboarding
 * can pre-populate "fill in your env vars" before first deploy.
 */
export function useScanEnvExample(projectId: string) {
  return useMutation({
    mutationFn: async (payload: { branch: string; sourceDir?: string }) => {
      const response = await apiClient.post<EnvExampleScanResult>(
        `/projects/${projectId}/repository/scan-env-example`,
        payload,
      );
      return response.data;
    },
  });
}

/**
 * Disconnects a connected repository from a project.
 */
export function useDisconnectRepo(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/projects/${projectId}/repository`);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...repositoryBaseQueryKey, projectId, 'connected'] }),
        queryClient.invalidateQueries({ queryKey: [...repositoryBaseQueryKey, projectId, 'available'] }),
      ]);
    },
  });
}
