'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/use-toast';
import {
  usePreviewConnection,
  useUpdateConnection,
} from '@/hooks/queries/use-connections';

/** Opt-in "expanded" connection vars per resource kind (mirrors the backend
 *  binding templates). The default var (DATABASE_URL / REDIS_URL) is always on. */
const EXPANDED_VARS: Record<string, string[]> = {
  POSTGRES: ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'],
  REDIS: ['REDIS_HOST', 'REDIS_PORT'],
  SPACES_BUCKET: [],
};

interface EdgeConfigPopoverProps {
  projectId: string;
  connectionId: string;
  /** Resource kind of the edge source, or null for service-link edges. */
  sourceResourceKind: 'POSTGRES' | 'REDIS' | 'SPACES_BUCKET' | null;
  /** Screen position to anchor the popover (click coordinates). */
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Phase B affordance: click a resource→service edge to preview the env vars it
 * injects and opt the "detailed" vars (PGHOST, PGPORT, …) in or out. Saves via
 * the connection's injectConfig.include.
 */
export function EdgeConfigPopover({
  projectId,
  connectionId,
  sourceResourceKind,
  position,
  onClose,
}: EdgeConfigPopoverProps) {
  const preview = usePreviewConnection(connectionId);
  const updateConnection = useUpdateConnection(projectId);

  const expandedVars = sourceResourceKind ? EXPANDED_VARS[sourceResourceKind] ?? [] : [];
  const injected = preview.data?.injectedVars ?? [];
  // Detailed vars are "on" when every expanded var is already injected.
  const detailedOn = useMemo(
    () => expandedVars.length > 0 && expandedVars.every((v) => injected.includes(v)),
    [expandedVars, injected],
  );

  const toggleDetailed = async () => {
    try {
      await updateConnection.mutateAsync({
        connectionId,
        injectConfig: detailedOn ? null : { include: expandedVars },
      });
      toast({
        title: detailedOn ? 'Detailed vars removed' : 'Detailed vars added',
        description: 'Hit Deploy to apply the new injection set.',
      });
      onClose();
    } catch {
      // useUpdateConnection surfaces its own error toast.
    }
  };

  return (
    <div
      className="liftoff-panel absolute z-30 w-72 rounded-lg border border-border bg-card/95 p-4 shadow-[0_18px_60px_hsl(252_30%_2%/0.4)]"
      style={{ left: position.x, top: position.y }}
    >
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">Connection</p>
          <p className="text-xs text-muted-foreground">
            {preview.data
              ? `${preview.data.source ?? 'source'} → ${preview.data.targetService ?? 'service'}`
              : 'Injected env vars'}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {preview.isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Spinner className="h-4 w-4" />
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1">
            {injected.length > 0 ? (
              injected.map((v) => (
                <span
                  key={v}
                  className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                >
                  {v}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No injected vars.</span>
            )}
          </div>

          {expandedVars.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => void toggleDetailed()}
              disabled={updateConnection.isPending}
            >
              {updateConnection.isPending ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : detailedOn ? (
                'Remove detailed vars'
              ) : (
                `Add detailed vars (${expandedVars.join(', ')})`
              )}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
