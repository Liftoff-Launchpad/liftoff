'use client';

import { useEffect, useState } from 'react';
import { Box, Database, HardDrive, Loader2, Trash2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  useDeleteResource,
  useUpdateResource,
  type ResourceKind,
} from '@/hooks/queries/use-resources';

/** DO managed-database size slugs offered for Postgres/Redis clusters. */
const DB_SIZE_OPTIONS = [
  { value: 'db-s-1vcpu-1gb', label: '1 vCPU · 1 GB (starter)' },
  { value: 'db-s-1vcpu-2gb', label: '1 vCPU · 2 GB' },
  { value: 'db-s-2vcpu-4gb', label: '2 vCPU · 4 GB' },
  { value: 'db-s-4vcpu-8gb', label: '4 vCPU · 8 GB' },
];

/** Engine versions DO offers per managed-database engine. */
const VERSION_OPTIONS: Partial<Record<ResourceKind, string[]>> = {
  POSTGRES: ['17', '16', '15', '14', '13'],
  REDIS: ['7', '6'],
};

const DEFAULT_VERSION: Partial<Record<ResourceKind, string>> = {
  POSTGRES: '15',
  REDIS: '7',
};

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
  config?: Record<string, unknown>;
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
  config,
  onDeleted,
}: ResourceDrawerProps) {
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState('');
  const deleteResource = useDeleteResource(projectId);
  const updateResource = useUpdateResource(projectId, resourceId);
  const meta = (kind && KIND_META[kind]) || { title: 'Resource', Icon: Box };
  const Icon = meta.Icon;

  // Managed databases (Postgres/Redis) expose engine version + cluster size; buckets don't.
  const isManagedDatabase = kind === 'POSTGRES' || kind === 'REDIS';
  const configVersion = typeof config?.version === 'string' ? config.version : undefined;
  const configSize = typeof config?.size === 'string' ? config.size : undefined;
  const defaultVersion = (kind && DEFAULT_VERSION[kind]) ?? '';
  const [versionDraft, setVersionDraft] = useState(configVersion ?? defaultVersion);
  const [sizeDraft, setSizeDraft] = useState(configSize ?? 'db-s-1vcpu-1gb');

  const versionOptions = (kind && VERSION_OPTIONS[kind]) ?? [];
  const configDirty =
    versionDraft !== (configVersion ?? defaultVersion) || sizeDraft !== (configSize ?? 'db-s-1vcpu-1gb');

  // The drawer stays mounted across node selections — re-sync drafts when the
  // selected resource (or its persisted config) changes.
  useEffect(() => {
    setVersionDraft(configVersion ?? defaultVersion);
    setSizeDraft(configSize ?? 'db-s-1vcpu-1gb');
    setTypedName('');
    setConfirming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, configVersion, configSize]);

  const handleSaveConfig = () => {
    updateResource.mutate(
      { config: { ...(config ?? {}), version: versionDraft, size: sizeDraft } },
      {
        onSuccess: () =>
          toast({
            title: 'Configuration saved',
            description: `${label} will provision as ${sizeDraft} on the next deploy.`,
          }),
      },
    );
  };

  // A provisioned resource (anything past DRAFT) holds real cloud state — the next
  // apply would DESTROY the live cluster + its data. Require typing the exact name
  // to confirm. DRAFT resources never reached the cloud, so a simple two-click is fine.
  const isProvisioned = status !== 'DRAFT';
  const canDelete = !isProvisioned || typedName.trim() === label;

  const handleDelete = () => {
    if (!canDelete) return;
    if (!isProvisioned && !confirming) {
      setConfirming(true);
      return;
    }
    deleteResource.mutate(resourceId, {
      onSuccess: () => {
        setConfirming(false);
        setTypedName('');
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

        {isManagedDatabase && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground">Configuration</h4>
            {isProvisioned ? (
              <>
                <dl className="mt-2 space-y-1.5">
                  <div className="flex items-baseline gap-3 text-sm">
                    <dt className="w-20 shrink-0 text-muted-foreground">Version</dt>
                    <dd className="font-mono text-foreground">{configVersion ?? defaultVersion}</dd>
                  </div>
                  <div className="flex items-baseline gap-3 text-sm">
                    <dt className="w-20 shrink-0 text-muted-foreground">Size</dt>
                    <dd className="font-mono text-foreground">{configSize ?? 'db-s-1vcpu-1gb'}</dd>
                  </div>
                </dl>
                <p className="mt-2 max-w-md text-xs text-muted-foreground">
                  This cluster is live. Engine version and size can&apos;t be changed from the canvas
                  after provisioning — resize it from the DigitalOcean control panel.
                </p>
              </>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Engine version</Label>
                  <Select value={versionDraft} onValueChange={setVersionDraft}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {versionOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {kind === 'POSTGRES' ? `PostgreSQL ${option}` : `Redis ${option}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Cluster size</Label>
                  <Select value={sizeDraft} onValueChange={setSizeDraft}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DB_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Button
                    size="sm"
                    onClick={handleSaveConfig}
                    disabled={!configDirty || updateResource.isPending}
                    className="gap-1.5"
                  >
                    {updateResource.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save configuration
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-5">
          <h4 className="text-sm font-medium text-red-300">Danger zone</h4>
          {isProvisioned ? (
            <p className="mt-1 text-xs text-muted-foreground">
              This resource is live. Deleting it will <strong className="text-red-300">destroy the
              managed {meta.title.toLowerCase()} and all its data</strong> on the next deploy. Type{' '}
              <code className="rounded bg-background/60 px-1 font-mono text-foreground">{label}</code>{' '}
              to confirm.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Removes this draft resource node and any edges connected to it. Nothing is provisioned
              yet, so no data is lost.
            </p>
          )}

          {isProvisioned && (
            <Input
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={label}
              className="mt-3 font-mono"
              autoComplete="off"
            />
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={deleteResource.isPending || !canDelete}
              className="gap-1.5 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-40"
            >
              {deleteResource.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {isProvisioned
                ? 'Delete & destroy on deploy'
                : confirming
                  ? 'Click again to confirm'
                  : 'Delete resource'}
            </Button>
            {confirming && !isProvisioned && !deleteResource.isPending && (
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
