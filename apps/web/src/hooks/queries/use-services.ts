'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface ServiceRecord {
  id: string;
  environmentId: string;
  repositoryId: string | null;
  name: string;
  kind: 'SERVICE' | 'WORKER' | 'JOB' | 'STATIC_SITE';
  sourceDir: string;
  buildStrategy: 'AUTO' | 'DOCKERFILE' | 'NIXPACKS';
  dockerfilePath: string;
  port: number;
  instanceSize: string;
  replicas: number;
  routePath: string | null;
  healthcheckPath: string | null;
  command: string | null;
  jobSchedule: string | null;
  jobKind: string | null;
  canvasPosition: { x: number; y: number } | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ServiceKind = 'SERVICE' | 'WORKER' | 'JOB' | 'STATIC_SITE';
export type JobKind = 'cron' | 'pre_deploy' | 'post_deploy' | 'failed_deploy';

export interface CreateServiceInput {
  name: string;
  kind?: ServiceKind;
  /** Which connected repo builds this service (Phase F). Defaults to primary. */
  repositoryId?: string | null;
  sourceDir?: string;
  buildStrategy?: 'AUTO' | 'DOCKERFILE' | 'NIXPACKS';
  dockerfilePath?: string;
  port?: number;
  instanceSize?: string;
  replicas?: number;
  routePath?: string;
  healthcheckPath?: string;
  /** Start command — set when the image has no detectable start (e.g. Node, no `start` script). */
  command?: string | null;
  /** JOB only — when in the deploy lifecycle the job runs. */
  jobKind?: JobKind | null;
  /** JOB only — cron expression (recorded; App Platform has no native scheduler). */
  jobSchedule?: string | null;
}

export interface UpdateServiceInput {
  name?: string;
  /** Re-point this service to another connected repo, or null to detach (Phase F). */
  repositoryId?: string | null;
  sourceDir?: string;
  buildStrategy?: 'AUTO' | 'DOCKERFILE' | 'NIXPACKS';
  dockerfilePath?: string;
  port?: number;
  instanceSize?: string;
  replicas?: number;
  routePath?: string | null;
  healthcheckPath?: string | null;
  command?: string | null;
}

const servicesBaseKey = ['services'] as const;

/**
 * Lists services for an environment.
 */
export function useServices(environmentId: string) {
  return useQuery({
    queryKey: [...servicesBaseKey, environmentId],
    enabled: Boolean(environmentId),
    queryFn: async () => {
      const response = await apiClient.get<ServiceRecord[]>(
        `/environments/${environmentId}/services`,
      );
      return response.data;
    },
  });
}

/**
 * Creates a new Service under an env. On success invalidates both the services
 * list AND the project's canvas so the new node appears immediately.
 */
export function useCreateService(environmentId: string, projectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateServiceInput) => {
      const response = await apiClient.post<ServiceRecord>(
        `/environments/${environmentId}/services`,
        payload,
      );
      return response.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...servicesBaseKey, environmentId] }),
        projectId
          ? queryClient.invalidateQueries({ queryKey: ['canvas', projectId] })
          : Promise.resolve(),
      ]);
    },
  });
}

/**
 * Updates a Service's mutable fields (instance size, replicas, route path, etc.).
 */
export function useUpdateService(serviceId: string, environmentId?: string, projectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateServiceInput) => {
      const response = await apiClient.patch<ServiceRecord>(`/services/${serviceId}`, payload);
      return response.data;
    },
    onSuccess: async () => {
      await Promise.all([
        environmentId
          ? queryClient.invalidateQueries({ queryKey: [...servicesBaseKey, environmentId] })
          : Promise.resolve(),
        projectId
          ? queryClient.invalidateQueries({ queryKey: ['canvas', projectId] })
          : Promise.resolve(),
      ]);
    },
  });
}

/**
 * Soft-deletes a Service.
 */
export function useDeleteService(environmentId?: string, projectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (serviceId: string) => {
      await apiClient.delete(`/services/${serviceId}`);
    },
    onSuccess: async () => {
      await Promise.all([
        environmentId
          ? queryClient.invalidateQueries({ queryKey: [...servicesBaseKey, environmentId] })
          : Promise.resolve(),
        projectId
          ? queryClient.invalidateQueries({ queryKey: ['canvas', projectId] })
          : Promise.resolve(),
      ]);
    },
  });
}
