'use client';

import { Eye, Loader2, Plus, Rocket, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TabsContent } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import {
  useApplyVariables,
  useBulkImportEnvironmentVariables,
  useBulkImportServiceVariables,
  useCreateEnvironmentVariable,
  useCreateServiceVariable,
  useDeleteEnvironmentVariable,
  useDeleteServiceVariable,
  useEnvironmentVariables,
  useServiceVariables,
  useUpdateEnvironmentVariable,
  useUpdateServiceVariable,
  type CreateVariableInput,
  type VariableKind,
  type VariableResponse,
  type VariableScope,
} from '@/hooks/queries/use-variables';
import { cn } from '@/lib/utils';

interface DrawerVariablesTabProps {
  /** Service.id — required to load and edit service-scoped variables. */
  serviceId: string;
  /** Environment.id — required to load env-scoped variables (inherited by all services). */
  environmentId: string;
  /** Vars auto-injected into this service by connected resources/services (read-only). */
  autoInjected?: Array<{ name: string; source: string }>;
}

type Scope = 'env' | 'service';

export function DrawerVariablesTab({
  serviceId,
  environmentId,
  autoInjected = [],
}: DrawerVariablesTabProps) {
  const [addingScope, setAddingScope] = useState<Scope | null>(null);
  const [rawEditorOpen, setRawEditorOpen] = useState(false);
  const [rawEditorScope, setRawEditorScope] = useState<Scope>('env');

  const envVars = useEnvironmentVariables(environmentId);
  const serviceVars = useServiceVariables(serviceId);
  const applyVariables = useApplyVariables(environmentId);

  const handleApply = async () => {
    try {
      const result = await applyVariables.mutateAsync();
      toast({
        title: 'Apply triggered',
        description: `Restarting ${result.deploymentCount} service${
          result.deploymentCount === 1 ? '' : 's'
        } with new variables (no rebuild).`,
      });
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast({
        title: 'Apply failed',
        description: message ?? 'See logs for details.',
        variant: 'destructive',
      });
    }
  };

  return (
    <TabsContent value="variables" className="m-0 p-8">
      {autoInjected.length > 0 && (
        <div className="mb-6 rounded-lg border border-blue-500/25 bg-blue-500/5 p-4">
          <h4 className="text-sm font-medium text-blue-300">Auto-injected from connections</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            These are set automatically at deploy time from edges drawn on the canvas. You don&apos;t
            need to add them — set your own var of the same name to override.
          </p>
          <ul className="mt-3 space-y-1.5">
            {autoInjected.map((entry) => (
              <li key={`${entry.source}-${entry.name}`} className="flex items-center gap-2 text-sm">
                <code className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {entry.name}
                </code>
                <span className="text-xs text-muted-foreground">← {entry.source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold">Variables</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Env vars + secrets exposed to your running containers (and build args at GitHub
            Actions time).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRawEditorScope('env');
              setRawEditorOpen(true);
            }}
          >
            Raw Editor (.env paste)
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={applyVariables.isPending}
            className="gap-2"
          >
            {applyVariables.isPending ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            Save &amp; Apply Now
          </Button>
        </div>
      </div>

      <section className="mt-8 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h5 className="text-sm font-semibold">Shared (environment)</h5>
            <p className="text-xs text-muted-foreground">
              Inherited by every service in this environment.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddingScope('env')}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New shared variable
          </Button>
        </div>

        {addingScope === 'env' && (
          <NewVariableRow
            scope="env"
            environmentId={environmentId}
            serviceId={serviceId}
            onDone={() => setAddingScope(null)}
          />
        )}

        <VariableList
          rows={envVars.data ?? []}
          isLoading={envVars.isLoading}
          scope="env"
          environmentId={environmentId}
          serviceId={serviceId}
        />
      </section>

      <section className="mt-10 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h5 className="text-sm font-semibold">Service-only (overrides)</h5>
            <p className="text-xs text-muted-foreground">
              Visible only to this service. Same key as a shared variable will win.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddingScope('service')}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New service variable
          </Button>
        </div>

        {addingScope === 'service' && (
          <NewVariableRow
            scope="service"
            environmentId={environmentId}
            serviceId={serviceId}
            onDone={() => setAddingScope(null)}
          />
        )}

        <VariableList
          rows={serviceVars.data ?? []}
          isLoading={serviceVars.isLoading}
          scope="service"
          environmentId={environmentId}
          serviceId={serviceId}
        />
      </section>

      <RawEditorDialog
        open={rawEditorOpen}
        onOpenChange={setRawEditorOpen}
        scope={rawEditorScope}
        onScopeChange={setRawEditorScope}
        environmentId={environmentId}
        serviceId={serviceId}
      />
    </TabsContent>
  );
}

// ─────────────────────── new variable row (inline form) ───────────────────────

function NewVariableRow({
  scope,
  environmentId,
  serviceId,
  onDone,
}: {
  scope: Scope;
  environmentId: string;
  serviceId: string;
  onDone: () => void;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [scopeFlag, setScopeFlag] = useState<VariableScope>('RUNTIME');
  const [kind, setKind] = useState<VariableKind>('PLAIN');

  const createEnv = useCreateEnvironmentVariable(environmentId);
  const createService = useCreateServiceVariable(serviceId);
  const isPending = scope === 'env' ? createEnv.isPending : createService.isPending;

  const handleSave = async () => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      toast({
        title: 'Invalid key',
        description: 'Use uppercase letters, digits, and underscores (POSIX env var format).',
        variant: 'destructive',
      });
      return;
    }
    const payload: CreateVariableInput = { key, value, scope: scopeFlag, kind };
    try {
      if (scope === 'env') {
        await createEnv.mutateAsync(payload);
      } else {
        await createService.mutateAsync(payload);
      }
      toast({ title: 'Variable added', description: `${key} saved. Takes effect on next deploy.` });
      onDone();
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast({
        title: 'Failed to add variable',
        description: message ?? 'Check the inputs and try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="grid grid-cols-[1fr_1fr_120px_110px_auto] items-end gap-2 rounded-lg border border-dashed border-border bg-background/40 p-3">
      <div className="space-y-1">
        <Label className="text-xs">Key</Label>
        <Input
          placeholder="OPENAI_API_KEY"
          value={key}
          onChange={(event) => setKey(event.target.value.toUpperCase())}
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Value</Label>
        <Input
          placeholder={kind === 'SECRET' ? '(stored encrypted)' : 'value'}
          value={value}
          type={kind === 'SECRET' ? 'password' : 'text'}
          onChange={(event) => setValue(event.target.value)}
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Scope</Label>
        <Select value={scopeFlag} onValueChange={(value) => setScopeFlag(value as VariableScope)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="RUNTIME">Runtime</SelectItem>
            <SelectItem value="BUILD">Build</SelectItem>
            <SelectItem value="BOTH">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Kind</Label>
        <Select value={kind} onValueChange={(value) => setKind(value as VariableKind)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PLAIN">Plain</SelectItem>
            <SelectItem value="SECRET">Secret</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" onClick={() => void handleSave()} disabled={isPending || !key || !value}>
          {isPending ? <Spinner className="h-3 w-3" /> : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────── variable list rows ──────────────────────────────

function VariableList({
  rows,
  isLoading,
  scope,
  environmentId,
  serviceId,
}: {
  rows: VariableResponse[];
  isLoading: boolean;
  scope: Scope;
  environmentId: string;
  serviceId: string;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-background/40 py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No {scope === 'env' ? 'shared' : 'service-only'} variables yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <VariableRow
          key={row.id}
          row={row}
          scope={scope}
          environmentId={environmentId}
          serviceId={serviceId}
        />
      ))}
    </div>
  );
}

function VariableRow({
  row,
  scope,
  environmentId,
  serviceId,
}: {
  row: VariableResponse;
  scope: Scope;
  environmentId: string;
  serviceId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState('');

  const updateEnv = useUpdateEnvironmentVariable(environmentId);
  const updateService = useUpdateServiceVariable(serviceId);
  const deleteEnv = useDeleteEnvironmentVariable(environmentId);
  const deleteService = useDeleteServiceVariable(serviceId);

  const update = scope === 'env' ? updateEnv : updateService;
  const remove = scope === 'env' ? deleteEnv : deleteService;

  const handleSave = async () => {
    try {
      await update.mutateAsync({ key: row.key, value: newValue });
      toast({ title: 'Variable updated', description: `${row.key} saved.` });
      setEditing(false);
      setNewValue('');
    } catch {
      toast({ title: 'Update failed', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${row.key}? This cannot be undone.`)) return;
    try {
      await remove.mutateAsync(row.key);
      toast({ title: 'Variable deleted', description: row.key });
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/30 px-3 py-2">
      <span className="min-w-[180px] max-w-[260px] truncate font-mono text-sm">{row.key}</span>

      <div className="flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="New value"
              type={row.kind === 'SECRET' ? 'password' : 'text'}
              className="font-mono text-sm"
            />
            <Button size="sm" onClick={() => void handleSave()} disabled={update.isPending || !newValue}>
              {update.isPending ? <Spinner className="h-3 w-3" /> : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setNewValue('');
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <span className="font-mono text-sm text-muted-foreground">
            {row.kind === 'SECRET' ? '••••••••' : row.value || <em className="opacity-60">(empty)</em>}
          </span>
        )}
      </div>

      {!editing && (
        <>
          <ScopeBadge scope={row.scope} />
          <KindBadge kind={row.kind} />

          <Button
            size="sm"
            variant="ghost"
            title={row.kind === 'SECRET' ? 'Change value' : 'Edit value'}
            onClick={() => setEditing(true)}
            className="h-7 w-7 p-0"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Delete"
            onClick={() => void handleDelete()}
            disabled={remove.isPending}
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

function ScopeBadge({ scope }: { scope: VariableScope }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase',
        scope === 'RUNTIME' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
        scope === 'BUILD' && 'border-blue-500/30 bg-blue-500/10 text-blue-400',
        scope === 'BOTH' && 'border-purple-500/30 bg-purple-500/10 text-purple-300',
      )}
    >
      {scope.toLowerCase()}
    </span>
  );
}

function KindBadge({ kind }: { kind: VariableKind }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase',
        kind === 'PLAIN' && 'border-border bg-secondary/60 text-muted-foreground',
        kind === 'SECRET' && 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      )}
    >
      {kind.toLowerCase()}
    </span>
  );
}

// ───────────────────────────── raw editor dialog ─────────────────────────────

function RawEditorDialog({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  environmentId,
  serviceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  environmentId: string;
  serviceId: string;
}) {
  const [content, setContent] = useState('');
  const [defaultScope, setDefaultScope] = useState<VariableScope>('RUNTIME');
  const [markAllAsSecret, setMarkAllAsSecret] = useState(false);
  const [overwrite, setOverwrite] = useState(false);

  const importEnv = useBulkImportEnvironmentVariables(environmentId);
  const importService = useBulkImportServiceVariables(serviceId);
  const isPending = scope === 'env' ? importEnv.isPending : importService.isPending;

  const handleSubmit = async () => {
    const payload = {
      envFileContent: content,
      defaultScope,
      markAllAsSecret,
      overwriteExisting: overwrite,
    };
    try {
      const results =
        scope === 'env' ? await importEnv.mutateAsync(payload) : await importService.mutateAsync(payload);
      const counts = results.reduce<Record<string, number>>((acc, result) => {
        acc[result.status] = (acc[result.status] ?? 0) + 1;
        return acc;
      }, {});
      const summary = Object.entries(counts)
        .map(([status, n]) => `${n} ${status}`)
        .join(', ');
      toast({ title: 'Imported', description: summary || 'No keys found.' });
      onOpenChange(false);
      setContent('');
    } catch {
      toast({ title: 'Import failed', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Raw Editor</DialogTitle>
          <DialogDescription>
            Paste a <code className="text-xs">.env</code>-formatted block. Lines starting with{' '}
            <code className="text-xs">#</code> are skipped. Keys must match POSIX env var format
            (uppercase + underscores).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Target</Label>
            <Select value={scope} onValueChange={(value) => onScopeChange(value as Scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="env">Shared (env-scoped)</SelectItem>
                <SelectItem value="service">Service-only (overrides)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Default scope</Label>
            <Select value={defaultScope} onValueChange={(value) => setDefaultScope(value as VariableScope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RUNTIME">Runtime</SelectItem>
                <SelectItem value="BUILD">Build</SelectItem>
                <SelectItem value="BOTH">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={`NODE_ENV=production\nOPENAI_API_KEY=sk-...\n# Optional\nDEBUG=false`}
          className="min-h-[260px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />

        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={markAllAsSecret}
              onChange={(event) => setMarkAllAsSecret(event.target.checked)}
            />
            Mark all as Secret
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            Overwrite existing
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isPending || !content.trim()}>
            {isPending ? <Spinner className="h-4 w-4" /> : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
