'use client';

import { useState } from 'react';
import { AlertTriangle, Code2, GitBranch, Globe, Network, Plus, Rocket, Search, Trash2, Zap } from 'lucide-react';
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
import { useTriggerDeployment } from '@/hooks/queries/use-deployments';
import { useStagedChangesStore } from '../staged-changes/staged-changes-store';

interface DrawerSettingsTabProps {
  nodeId: string;
  environmentId: string;
  instanceSize?: string;
  replicas?: number;
  domains?: string[];
  onAddDomain?: (domain: string) => void;
  onChangeScaling?: (instanceSize: string, replicas: number) => void;
}

const INSTANCE_SIZES = [
  'apps-s-1vcpu-0.5gb',
  'apps-s-1vcpu-1gb',
  'apps-s-2vcpu-2gb',
  'apps-s-2vcpu-4gb',
  'apps-s-4vcpu-8gb',
];

export function DrawerSettingsTab({
  nodeId,
  environmentId,
  instanceSize = 'apps-s-1vcpu-0.5gb',
  replicas = 1,
  domains = [],
  onAddDomain,
  onChangeScaling,
}: DrawerSettingsTabProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [currentSize, setCurrentSize] = useState(instanceSize);
  const [currentReplicas, setCurrentReplicas] = useState(replicas);

  const triggerDeployment = useTriggerDeployment(environmentId);
  const addChange = useStagedChangesStore((s) => s.addChange);

  const handleRedeploy = async () => {
    try {
      await triggerDeployment.mutateAsync({});
    } catch {
      // handled in component
    }
  };

  const handleScalingChange = (size: string, repl: number) => {
    setCurrentSize(size);
    setCurrentReplicas(repl);
    onChangeScaling?.(size, repl);
    addChange({
      nodeId,
      type: 'CHANGE_SCALING',
      label: `Change scaling to ${size} x${repl}`,
      payload: { instanceSize: size, replicas: repl },
    });
  };

  const handleAddDomain = () => {
    if (!newDomain.trim()) return;
    onAddDomain?.(newDomain.trim());
    setNewDomain('');
  };

  return (
    <TabsContent value="settings" className="m-0 p-10">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-10 bg-background/50 pl-9" placeholder="Filter Settings..." />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          /
        </kbd>
      </div>

      <div className="mt-10 grid grid-cols-[1fr_150px] gap-12">
        <div className="relative space-y-12 before:absolute before:left-5 before:top-8 before:h-[calc(100%-2rem)] before:w-px before:bg-border">
          <section id="source" className="relative grid grid-cols-[42px_1fr] gap-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
              <Code2 className="h-5 w-5" />
            </span>
            <div className="space-y-6">
              <div>
                <h4 className="text-2xl font-semibold">Source</h4>
                <p className="mt-2 text-sm text-muted-foreground">Connect repository and launch settings for this service.</p>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Source Repo</Label>
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/60 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Rocket className="h-4 w-4 shrink-0 text-foreground" />
                    <span className="truncate font-medium">Connected GitHub repository</span>
                  </div>
                  <Button variant="outline" size="sm">Disconnect</Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Branch connected to production</Label>
                <p className="text-sm text-muted-foreground">
                  Changes made to this branch will automatically deploy to this environment.
                </p>
                <div className="overflow-hidden rounded-lg border border-border bg-secondary/50">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="inline-flex items-center gap-3 font-medium">
                      <GitBranch className="h-4 w-4" />
                      main
                    </span>
                    <Button variant="outline" size="sm">Disconnect</Button>
                  </div>
                  <div className="flex items-center justify-between border-t border-border bg-background/30 px-4 py-3 text-sm">
                    <span className="inline-flex items-center gap-3">
                      <Zap className="h-4 w-4 text-primary" />
                      Auto deploys when pushed to GitHub
                    </span>
                    <Button variant="outline" size="sm">Disable</Button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Wait for CI</Label>
                <p className="text-sm text-muted-foreground">Trigger deployments after all GitHub Actions complete successfully.</p>
                <button
                  type="button"
                  className="flex h-12 w-full items-center rounded-lg border border-border bg-secondary/50 px-4 text-left"
                >
                  <span className="mr-4 h-6 w-10 rounded-full bg-muted p-0.5">
                    <span className="block h-5 w-5 rounded-full bg-foreground" />
                  </span>
                  Wait for CI
                </button>
              </div>
            </div>
          </section>

          <section id="networking" className="relative grid grid-cols-[42px_1fr] gap-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
              <Network className="h-5 w-5" />
            </span>
            <div className="space-y-5">
              <div>
                <h4 className="text-2xl font-semibold">Networking</h4>
                <p className="mt-2 text-sm text-muted-foreground">Expose this service through generated or custom domains.</p>
              </div>
              <div className="space-y-2">
                {domains.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-background/35 px-4 py-4 text-sm text-muted-foreground">
                    No custom domains configured.
                  </p>
                ) : (
                  domains.map((domain) => (
                    <div key={domain} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                      <span className="font-mono">{domain}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-emerald-500">Active</span>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="api.myapp.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  className="flex-1 text-sm"
                />
                <Button size="sm" onClick={() => void handleAddDomain()}>
                  <Plus className="mr-2 h-3 w-3" />
                  Custom Domain
                </Button>
              </div>
            </div>
          </section>

          <section id="scale" className="relative grid grid-cols-[42px_1fr] gap-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
              <Globe className="h-5 w-5" />
            </span>
            <div className="space-y-5">
              <h4 className="text-2xl font-semibold">Scale</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="instance-size" className="text-xs text-muted-foreground">Instance Size</Label>
                  <Select value={currentSize} onValueChange={(v) => handleScalingChange(v, currentReplicas)}>
                    <SelectTrigger id="instance-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INSTANCE_SIZES.map((size) => (
                        <SelectItem key={size} value={size}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="replicas" className="text-xs text-muted-foreground">Replicas</Label>
                  <Select value={String(currentReplicas)} onValueChange={(v) => handleScalingChange(currentSize, Number(v))}>
                    <SelectTrigger id="replicas">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </section>

          <section id="danger" className="relative grid grid-cols-[42px_1fr] gap-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="space-y-4">
              <h4 className="text-2xl font-semibold text-destructive">Danger</h4>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRedeploy()}
                  disabled={triggerDeployment.isPending}
                >
                  {triggerDeployment.isPending ? <Spinner className="h-3 w-3" /> : <Rocket className="mr-1 h-3 w-3" />}
                  Redeploy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete Environment
                </Button>
              </div>
            </div>
          </section>
        </div>

        <nav className="sticky top-0 hidden h-fit space-y-3 pt-1 text-sm text-muted-foreground lg:block">
          <a href="#source" className="block text-foreground">Source</a>
          <a href="#networking" className="block hover:text-foreground">Networking</a>
          <a href="#scale" className="block hover:text-foreground">Scale</a>
          <span className="block">Build</span>
          <span className="block">Deploy</span>
          <span className="block">Config-as-code</span>
          <span className="block">Feature-flags</span>
          <a href="#danger" className="block hover:text-foreground">Danger</a>
        </nav>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Environment</DialogTitle>
            <DialogDescription>
              This action cannot be undone. All deployments and data associated with this environment will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowDeleteDialog(false);
                // deletion handled via API
              }}
            >
              Delete Environment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
