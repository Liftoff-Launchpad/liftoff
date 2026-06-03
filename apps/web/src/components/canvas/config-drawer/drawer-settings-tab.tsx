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
import { toast } from '@/components/ui/use-toast';
import { useRedeployEnvironment, useTriggerBuild } from '@/hooks/queries/use-environments';
import { useDeleteService, useUpdateService } from '@/hooks/queries/use-services';
import { useStagedChangesStore } from '../staged-changes/staged-changes-store';

interface DrawerSettingsTabProps {
  /** Service.id selected on the canvas. */
  nodeId: string;
  /** Service.name — used for the delete-confirm dialog label. */
  nodeName?: string;
  environmentId: string;
  /** Required for redeploy + delete invalidations. */
  projectId: string;
  instanceSize?: string;
  replicas?: number;
  /** Current Service.command (start command override). */
  command?: string | null;
  domains?: string[];
  onAddDomain?: (domain: string) => void;
  onChangeScaling?: (instanceSize: string, replicas: number) => void;
  /** Called when the user confirms a service delete so the parent can close the drawer. */
  onServiceDeleted?: () => void;
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
  nodeName,
  environmentId,
  projectId,
  instanceSize = 'apps-s-1vcpu-0.5gb',
  replicas = 1,
  command,
  domains = [],
  onAddDomain,
  onChangeScaling,
  onServiceDeleted,
}: DrawerSettingsTabProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [currentSize, setCurrentSize] = useState(instanceSize);
  const [currentReplicas, setCurrentReplicas] = useState(replicas);
  const [commandDraft, setCommandDraft] = useState(command ?? '');

  const redeployEnv = useRedeployEnvironment(projectId, environmentId);
  const triggerBuild = useTriggerBuild(projectId, environmentId);
  const deleteService = useDeleteService(environmentId, projectId);
  const updateService = useUpdateService(nodeId, environmentId, projectId);
  const addChange = useStagedChangesStore((s) => s.addChange);

  const handleSaveCommand = async () => {
    try {
      await updateService.mutateAsync({ command: commandDraft.trim() || null });
      toast({
        title: 'Start command saved',
        description: 'Rebuild (Deploy now) for it to take effect on the next image.',
      });
    } catch {
      toast({ title: 'Could not save start command', variant: 'destructive' });
    }
  };

  const handleTriggerBuild = async () => {
    try {
      const result = await triggerBuild.mutateAsync();
      toast({
        title: 'Build triggered',
        description: `GitHub Actions started on ${result.repository}@${result.ref}. The deploy-complete webhook will land in ~30–60s.`,
      });
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast({
        title: 'Trigger failed',
        description:
          message ?? 'Check that the repo is still connected and Liftoff has workflow permissions.',
        variant: 'destructive',
      });
    }
  };

  const handleRedeploy = async () => {
    try {
      const result = await redeployEnv.mutateAsync();
      toast({
        title: 'Redeploy queued',
        description: `Restarting ${result.deploymentCount} service${
          result.deploymentCount === 1 ? '' : 's'
        } with their last good images.`,
      });
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast({
        title: 'Redeploy failed',
        description:
          message ?? 'Make sure each service has at least one successful deployment first.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteService = async () => {
    try {
      await deleteService.mutateAsync(nodeId);
      toast({
        title: 'Service deleted',
        description: `${nodeName ?? 'Service'} removed. Click Redeploy to drop it from App Platform.`,
      });
      setShowDeleteDialog(false);
      onServiceDeleted?.();
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast({
        title: 'Delete failed',
        description: message ?? 'See logs for details.',
        variant: 'destructive',
      });
    }
  };

  const handleScalingChange = (size: string, repl: number) => {
    setCurrentSize(size);
    setCurrentReplicas(repl);
    onChangeScaling?.(size, repl);
  };

  const scalingDirty = currentSize !== instanceSize || currentReplicas !== replicas;

  const handleSaveScaling = async () => {
    try {
      await updateService.mutateAsync({ instanceSize: currentSize, replicas: currentReplicas });
      toast({
        title: 'Scaling saved',
        description: 'Hit Deploy on the canvas to roll the new size/replicas out.',
      });
    } catch {
      toast({ title: 'Could not save scaling', variant: 'destructive' });
    }
  };

  const handleAddDomain = () => {
    if (!newDomain.trim()) return;
    if (onAddDomain) {
      onAddDomain(newDomain.trim());
      setNewDomain('');
      return;
    }
    toast({
      title: 'Custom domains coming soon',
      description: 'Domain management isn’t wired up yet.',
    });
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
                  </div>
                  <div className="flex items-center justify-between border-t border-border bg-background/30 px-4 py-3 text-sm">
                    <span className="inline-flex items-center gap-3">
                      <Zap className="h-4 w-4 text-primary" />
                      Auto deploys when pushed to GitHub
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="svc-start-command" className="text-sm font-semibold">
                  Start command
                </Label>
                <p className="text-sm text-muted-foreground">
                  Overrides the container start. Set this if the build fails with “No start command
                  could be found”. Rebuild (Deploy now) for it to take effect.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    id="svc-start-command"
                    placeholder="node server.js"
                    value={commandDraft}
                    onChange={(event) => setCommandDraft(event.target.value)}
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    onClick={handleSaveCommand}
                    disabled={updateService.isPending || commandDraft === (command ?? '')}
                  >
                    Save
                  </Button>
                </div>
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
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSaveScaling()}
                  disabled={!scalingDirty || updateService.isPending}
                >
                  Save scaling
                </Button>
                <p className="text-xs text-muted-foreground">
                  Applies on the next Deploy — the App is resized in place (no rebuild).
                </p>
              </div>
            </div>
          </section>

          <section id="danger" className="relative grid grid-cols-[42px_1fr] gap-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="space-y-4">
              <h4 className="text-2xl font-semibold text-destructive">Danger</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">Deploy now</strong> — kicks a fresh GitHub
                  Actions build on the latest commit. Works even for first-time deploys.
                </li>
                <li>
                  <strong className="text-foreground">Redeploy</strong> — reuses each service&apos;s
                  last successful image (no rebuild). Needs prior SUCCESS for every service.
                </li>
                <li>
                  <strong className="text-foreground">Delete service</strong> — removes only this
                  service. Click Redeploy after to drop it from App Platform.
                </li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void handleTriggerBuild()}
                  disabled={triggerBuild.isPending}
                >
                  {triggerBuild.isPending ? (
                    <Spinner className="mr-1 h-3 w-3" />
                  ) : (
                    <Rocket className="mr-1 h-3 w-3" />
                  )}
                  Deploy now
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRedeploy()}
                  disabled={redeployEnv.isPending}
                >
                  {redeployEnv.isPending ? (
                    <Spinner className="mr-1 h-3 w-3" />
                  ) : (
                    <Rocket className="mr-1 h-3 w-3" />
                  )}
                  Redeploy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={deleteService.isPending}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete service
                </Button>
              </div>
            </div>
          </section>
        </div>

        <nav className="sticky top-0 hidden h-fit space-y-3 pt-1 text-sm text-muted-foreground lg:block">
          <a href="#source" className="block text-foreground">Source</a>
          <a href="#networking" className="block hover:text-foreground">Networking</a>
          <a href="#scale" className="block hover:text-foreground">Scale</a>
          <a href="#danger" className="block hover:text-foreground">Danger</a>
        </nav>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete service{nodeName ? ` "${nodeName}"` : ''}?</DialogTitle>
            <DialogDescription>
              This removes the service row from the canvas + regenerates the GitHub
              Actions workflow. The App Platform component stays live until you click
              <strong> Redeploy environment</strong> — that&apos;s when Pulumi reconciles
              and drops it. Deployment history for this service is preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteService()}
              disabled={deleteService.isPending}
            >
              {deleteService.isPending ? <Spinner className="h-4 w-4" /> : 'Delete service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
