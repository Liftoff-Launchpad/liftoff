'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export type VariableScope = 'BUILD' | 'RUNTIME' | 'BOTH';
export type VariableKind = 'PLAIN' | 'SECRET';

export interface VariableResponse {
  id: string;
  key: string;
  /** Null for SECRET kind (write-only by design). */
  value: string | null;
  scope: VariableScope;
  kind: VariableKind;
  hasValue: boolean;
  createdBy: string | null;
  lastRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedVariableEntry {
  key: string;
  /** Null for SECRET (redacted in this view). */
  value: string | null;
  scope: VariableScope;
  kind: VariableKind;
  source: 'environment' | 'service';
}

export interface CreateVariableInput {
  key: string;
  value: string;
  scope?: VariableScope;
  kind?: VariableKind;
}

export interface UpdateVariableInput {
  value?: string;
  scope?: VariableScope;
  kind?: VariableKind;
}

export interface BulkImportInput {
  envFileContent: string;
  defaultScope?: VariableScope;
  markAllAsSecret?: boolean;
  overwriteExisting?: boolean;
}

export interface BulkImportResult {
  key: string;
  status: 'created' | 'updated' | 'skipped' | 'invalid';
  reason?: string;
}

const envVarsKey = (envId: string) => ['variables', 'env', envId] as const;
const serviceVarsKey = (serviceId: string) => ['variables', 'service', serviceId] as const;
const resolvedVarsKey = (serviceId: string) => ['variables', 'resolved', serviceId] as const;

/** Env-scoped variable list. Inherited by every service in the env. */
export function useEnvironmentVariables(environmentId: string) {
  return useQuery({
    queryKey: envVarsKey(environmentId),
    enabled: Boolean(environmentId),
    queryFn: async () => {
      const response = await apiClient.get<VariableResponse[]>(
        `/environments/${environmentId}/variables`,
      );
      return response.data;
    },
  });
}

/** Service-scoped variable list. Overrides env-scoped on shared keys. */
export function useServiceVariables(serviceId: string) {
  return useQuery({
    queryKey: serviceVarsKey(serviceId),
    enabled: Boolean(serviceId),
    queryFn: async () => {
      const response = await apiClient.get<VariableResponse[]>(
        `/services/${serviceId}/variables`,
      );
      return response.data;
    },
  });
}

/** Resolved env+service merged view for a service (debug). SECRETs redacted. */
export function useResolvedVariables(serviceId: string) {
  return useQuery({
    queryKey: resolvedVarsKey(serviceId),
    enabled: Boolean(serviceId),
    queryFn: async () => {
      const response = await apiClient.get<ResolvedVariableEntry[]>(
        `/services/${serviceId}/variables/resolved`,
      );
      return response.data;
    },
  });
}

function invalidateEnvAndResolved(queryClient: ReturnType<typeof useQueryClient>, environmentId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: envVarsKey(environmentId) }),
    queryClient.invalidateQueries({ queryKey: ['variables', 'resolved'] }),
  ]);
}

function invalidateServiceAndResolved(
  queryClient: ReturnType<typeof useQueryClient>,
  serviceId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: serviceVarsKey(serviceId) }),
    queryClient.invalidateQueries({ queryKey: resolvedVarsKey(serviceId) }),
  ]);
}

export function useCreateEnvironmentVariable(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateVariableInput) => {
      const response = await apiClient.post<VariableResponse>(
        `/environments/${environmentId}/variables`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => invalidateEnvAndResolved(queryClient, environmentId),
  });
}

export function useUpdateEnvironmentVariable(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, ...payload }: UpdateVariableInput & { key: string }) => {
      const response = await apiClient.patch<VariableResponse>(
        `/environments/${environmentId}/variables/${encodeURIComponent(key)}`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => invalidateEnvAndResolved(queryClient, environmentId),
  });
}

export function useDeleteEnvironmentVariable(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      await apiClient.delete(`/environments/${environmentId}/variables/${encodeURIComponent(key)}`);
    },
    onSuccess: () => invalidateEnvAndResolved(queryClient, environmentId),
  });
}

export function useBulkImportEnvironmentVariables(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BulkImportInput) => {
      const response = await apiClient.post<BulkImportResult[]>(
        `/environments/${environmentId}/variables/import`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => invalidateEnvAndResolved(queryClient, environmentId),
  });
}

export function useCreateServiceVariable(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateVariableInput) => {
      const response = await apiClient.post<VariableResponse>(
        `/services/${serviceId}/variables`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => invalidateServiceAndResolved(queryClient, serviceId),
  });
}

export function useUpdateServiceVariable(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, ...payload }: UpdateVariableInput & { key: string }) => {
      const response = await apiClient.patch<VariableResponse>(
        `/services/${serviceId}/variables/${encodeURIComponent(key)}`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => invalidateServiceAndResolved(queryClient, serviceId),
  });
}

export function useDeleteServiceVariable(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      await apiClient.delete(`/services/${serviceId}/variables/${encodeURIComponent(key)}`);
    },
    onSuccess: () => invalidateServiceAndResolved(queryClient, serviceId),
  });
}

export function useBulkImportServiceVariables(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BulkImportInput) => {
      const response = await apiClient.post<BulkImportResult[]>(
        `/services/${serviceId}/variables/import`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => invalidateServiceAndResolved(queryClient, serviceId),
  });
}

/** Apply current vault values to the running app without rebuilding images. */
export function useApplyVariables(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<{ bundleId: string; deploymentCount: number }>(
        `/environments/${environmentId}/variables/apply`,
      );
      return response.data;
    },
    onSuccess: () => {
      // Refresh deployments/canvas so the user sees the new bundle.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deployments'] }),
        queryClient.invalidateQueries({ queryKey: ['canvas'] }),
      ]);
    },
  });
}
