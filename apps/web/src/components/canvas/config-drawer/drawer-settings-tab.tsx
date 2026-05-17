'use client';

import { useState } from 'react';
import { AlertTriangle, Globe, Plus, Rocket, Trash2 } from 'lucide-react';
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
    <TabsContent value="settings" className="flex h-full flex-col gap-6 p-4">
      <section className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4" />
          Domains
        </h4>
        <div className="space-y-2">
          {domains.length === 0 ? (
            <p className="text-xs text-muted-foreground">No custom domains configured.</p>
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
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold">Scaling</h4>
        <div className="space-y-2">
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
      </section>

      <section className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger Zone
        </h4>
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
      </section>

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
