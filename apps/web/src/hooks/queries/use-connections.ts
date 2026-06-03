'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/components/ui/use-toast';

/** Extracts a user-facing message from an Axios/AppException error. */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return fallback;
}

export type ConnectionKind = 'RESOURCE_BINDING' | 'SERVICE_LINK';

export interface ConnectionRecord {
  id: string;
  environmentId: string;
  kind: ConnectionKind;
  sourceResourceId: string | null;
  sourceServiceId: string | null;
  targetServiceId: string;
  injectConfig: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateConnectionInput {
  environmentId: string;
  /** Node id of the source (a Resource or a Service). */
  sourceId: string;
  /** Node id of the target service (the consumer). */
  targetId: string;
}

/**
 * Per-edge override of the injected vars. `include` opts into expanded vars
 * (e.g. PGHOST/PGPORT); `rename` maps an injected var to a different name.
 */
export interface InjectConfig {
  include?: string[];
  rename?: Record<string, string>;
}

export interface ConnectionPreview {
  connectionId: string;
  kind: ConnectionKind;
  source: string | null;
  targetService: string | null;
  injectedVars: string[];
  secretVars: string[];
}

/**
 * Persists a user-drawn edge. The backend infers the edge kind from the source
 * (Resource → binding, Service → link). Refreshes the canvas so the optimistic
 * edge reconciles with server truth (and rolls back on a rejected edge).
 */
export function useCreateConnection(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ environmentId, sourceId, targetId }: CreateConnectionInput) => {
      const response = await apiClient.post<ConnectionRecord>(
        `/environments/${environmentId}/connections`,
        { sourceId, targetId },
      );
      return response.data;
    },
    onError: (error: unknown) => {
      toast({
        title: "Couldn't connect those nodes",
        description: apiErrorMessage(error, 'That connection is not allowed.'),
        variant: 'destructive',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
    },
  });
}

/**
 * Updates an edge's injected-var override (rename / opt-in expanded vars), then
 * refreshes the canvas so edge labels reflect the new injection set.
 */
export function useUpdateConnection(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      connectionId,
      injectConfig,
    }: {
      connectionId: string;
      injectConfig: InjectConfig | null;
    }) => {
      const response = await apiClient.patch<ConnectionRecord>(
        `/connections/${connectionId}`,
        { injectConfig },
      );
      return response.data;
    },
    onError: (error: unknown) => {
      toast({
        title: "Couldn't update that connection",
        description: apiErrorMessage(error, 'The connection override could not be saved.'),
        variant: 'destructive',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
    },
  });
}

/**
 * Deletes an edge and refreshes the canvas.
 */
export function useDeleteConnection(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      await apiClient.delete(`/connections/${connectionId}`);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
    },
  });
}

/**
 * Previews the vars an edge injects into its target — read-only, used to show a
 * "this connection adds DATABASE_URL" affordance before/after wiring. Enabled
 * only when a connection id is supplied.
 */
export function usePreviewConnection(connectionId: string | null) {
  return useQuery({
    queryKey: ['connection-preview', connectionId],
    enabled: Boolean(connectionId),
    queryFn: async (): Promise<ConnectionPreview> => {
      const response = await apiClient.get<ConnectionPreview>(
        `/connections/${connectionId}/preview`,
      );
      return response.data;
    },
  });
}
