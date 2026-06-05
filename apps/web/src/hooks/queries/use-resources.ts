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

export type ResourceKind = 'POSTGRES' | 'REDIS' | 'SPACES_BUCKET';
export type ResourceStatus = 'DRAFT' | 'PROVISIONING' | 'ACTIVE' | 'FAILED' | 'DESTROYING';

export interface ResourceRecord {
  id: string;
  environmentId: string;
  kind: ResourceKind;
  name: string;
  config: Record<string, unknown> | null;
  status: ResourceStatus;
  outputs: Record<string, string> | null;
  canvasPosition: { x: number; y: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResourceInput {
  environmentId: string;
  kind: ResourceKind;
  name?: string;
  config?: Record<string, unknown>;
  canvasPosition?: { x: number; y: number };
}

export interface UpdateResourceInput {
  name?: string;
  config?: Record<string, unknown>;
  canvasPosition?: { x: number; y: number };
}

/**
 * Lists graph Resource nodes for an environment.
 */
export function useResources(environmentId: string) {
  return useQuery({
    queryKey: ['resources', environmentId],
    enabled: Boolean(environmentId),
    queryFn: async () => {
      const response = await apiClient.get<ResourceRecord[]>(
        `/environments/${environmentId}/resources`,
      );
      return response.data;
    },
  });
}

/**
 * Creates a DRAFT Resource node and refreshes the canvas so it appears.
 */
export function useCreateResource(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ environmentId, ...body }: CreateResourceInput) => {
      const response = await apiClient.post<ResourceRecord>(
        `/environments/${environmentId}/resources`,
        body,
      );
      return response.data;
    },
    onError: (error: unknown) => {
      toast({
        title: "Couldn't add that resource",
        description: apiErrorMessage(error, 'Please try again.'),
        variant: 'destructive',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
    },
  });
}

/**
 * Updates a Resource node's name/config (e.g. engine version or cluster size for
 * a DRAFT database) and refreshes the canvas.
 */
export function useUpdateResource(projectId: string, resourceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: UpdateResourceInput) => {
      const response = await apiClient.patch<ResourceRecord>(`/resources/${resourceId}`, body);
      return response.data;
    },
    onError: (error: unknown) => {
      toast({
        title: "Couldn't update that resource",
        description: apiErrorMessage(error, 'Please try again.'),
        variant: 'destructive',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
    },
  });
}

/**
 * Deletes a Resource node (and its edges) and refreshes the canvas.
 */
export function useDeleteResource(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (resourceId: string) => {
      await apiClient.delete(`/resources/${resourceId}`);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
    },
  });
}
