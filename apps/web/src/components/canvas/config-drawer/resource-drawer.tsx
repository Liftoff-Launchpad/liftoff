'use client';

import { useState } from 'react';
import { Box, Database, HardDrive, Loader2, Trash2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDeleteResource, type ResourceKind } from '@/hooks/queries/use-resources';

interface ResourceDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  resourceId: string;
  label: string;
  kind?: ResourceKind;
  status?: string;
  hostname?: string;
  port?: number;
  bucketName?: string;
  outputs?: Record<string, string>;
  onDeleted: () => void;
}

const KIND_META: Record<ResourceKind, { title: string; Icon: typeof Database }> = {
  POSTGRES: { title: 'Managed PostgreSQL', Icon: Database },
  REDIS: { title: 'Managed Redis', Icon: Zap },
  SPACES_BUCKET: { title: 'Spaces Bucket', Icon: HardDrive },
};

/**
 * Config panel for a graph Resource node (managed Postgres / Redis / bucket).
 * Distinct from the service ConfigDrawer — a resource has no deploy/scale/variables
 * tabs; it shows connection details and a delete action. Wiring a resource into a
 * service is done by drawing an edge on the canvas (Phase B injects the vars).
 */
export function ResourceDrawer({
  open,
  onClose,
  projectId,
  resourceId,
  label,
  kind,
  status = 'DRAFT',
  hostname,
  port,
  bucketName,
  outputs,
  onDeleted,
}: ResourceDrawerProps) {
  const [confirming, setConfirming] = useState(false);
  const deleteResource = useDeleteResource(projectId);
  const meta = (kind && KIND_META[kind]) || { title: 'Resource', Icon: Box };
  const Icon = meta.Icon;

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    deleteResource.mutate(resourceId, {
      onSuccess: () => {
        setConfirming(false);
        onDeleted();
      },
    });
  };

  const details: { label: string; value: string }[] = [];
  if (hostname) details.push({ label: 'Host', value: hostname });
  if (port) details.push({ label: 'Port', value: String(port) });
  if (bucketName) details.push({ label: 'Bucket', value: bucketName });
  if (outputs?.endpoint) details.push({ label: 'Endpoint', value: outputs.endpoint });

  return (
    <div
      className={cn(
        'absolute bottom-0 right-0 top-16 z-20 w-[min(1120px,52vw)] min-w-[560px] overflow-hidden border-l border-border bg-card shadow-[0_24px_80px_hsl(252_30%_2%/0.48)] transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="border-b border-border px-10 pt-8 pb-7">
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-2xl font-semibold tracking-normal">{label}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{meta.title}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-8 overflow-y-auto px-10 py-8">
        <section>
          <h4 className="text-sm font-medium text-muted-foreground">Status</h4>
          <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm">
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                status === 'ACTIVE'
                  ? 'bg-emerald-500'
                  : status === 'FAILED'
                    ? 'bg-red-500'
                    : status === 'DRAFT'
                      ? 'bg-amber-400'
                      : 'bg-muted-foreground/50',
              )}
            />
            <span className="font-mono">{status}</span>
          </div>
          {status === 'DRAFT' && (
            <p className="mt-2 max-w-md text-xs text-muted-foreground">
              This resource is staged on the canvas. It will be provisioned on the next deploy.
              Draw an edge from it to a service to inject its connection variables.
            </p>
          )}
        </section>

        {details.length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground">Connection</h4>
            <dl className="mt-2 space-y-1.5">
              {details.map((d) => (
                <div key={d.label} className="flex items-baseline gap-3 text-sm">
                  <dt className="w-20 shrink-0 text-muted-foreground">{d.label}</dt>
                  <dd className="min-w-0 break-all font-mono text-foreground">{d.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-5">
          <h4 className="text-sm font-medium text-red-300">Danger zone</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Removes this resource node and any edges connected to it.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={deleteResource.isPending}
              className="gap-1.5 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
            >
              {deleteResource.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {confirming ? 'Click again to confirm' : 'Delete resource'}
            </Button>
            {confirming && !deleteResource.isPending && (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
