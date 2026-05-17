'use client';

import { Plus, Rocket, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useAutoSetup } from '@/hooks/queries/use-canvas';
import { useAvailableRepos } from '@/hooks/queries/use-repositories';
import { useDoAccounts } from '@/hooks/queries/use-do-accounts';
import { useEnvironments, useCreateEnvironment } from '@/hooks/queries/use-environments';
import type { AvailableRepository } from '@/hooks/queries/use-repositories';
import { toast } from '@/components/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface CanvasEmptyStateProps {
  projectId: string;
  onSetupComplete?: () => void;
}

export function CanvasEmptyState({ projectId, onSetupComplete }: CanvasEmptyStateProps) {
  const [selectedRepo, setSelectedRepo] = useState<AvailableRepository | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSetupInProgress, setIsSetupInProgress] = useState(false);
  const [setupStep, setSetupStep] = useState('');

  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [envMode, setEnvMode] = useState<'select' | 'create'>('select');
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvBranch, setNewEnvBranch] = useState('');
  const [selectedDoAccountId, setSelectedDoAccountId] = useState('');
  const [isCreatingEnv, setIsCreatingEnv] = useState(false);

  const { data: availableRepos, isLoading: reposLoading } = useAvailableRepos(projectId);
  const { data: doAccounts } = useDoAccounts();
  const { data: environments, isLoading: envsLoading } = useEnvironments(projectId);
  const createEnvironmentMutation = useCreateEnvironment(projectId);
  const autoSetupMutation = useAutoSetup(projectId);
  const queryClient = useQueryClient();

  const filteredRepos = availableRepos?.filter(
    (repo) =>
      repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const hasEnvironments = environments && environments.length > 0;

  const handleAutoDeployClick = () => {
    if (!selectedRepo) return;

    const defaultDoAccount = doAccounts?.[0];
    if (defaultDoAccount) {
      setSelectedDoAccountId(defaultDoAccount.id);
    }

    setNewEnvBranch(selectedRepo.defaultBranch);
    setNewEnvName(selectedRepo.defaultBranch === 'main' ? 'production' : selectedRepo.defaultBranch);

    if (environments && environments.length > 0) {
      setEnvMode('select');
      const first = environments[0];
      if (first) setSelectedEnvId(first.id);
    } else {
      setEnvMode('create');
    }

    setEnvDialogOpen(true);
  };

  const handleEnvConfirmAndDeploy = async () => {
    if (!selectedRepo) return;

    let environmentId: string | undefined;

    if (envMode === 'select' && selectedEnvId) {
      environmentId = selectedEnvId;
    } else if (envMode === 'create') {
      if (!newEnvName.trim() || !newEnvBranch.trim() || !selectedDoAccountId) {
        toast({
          title: 'Missing fields',
          description: 'Please fill in all fields to create an environment.',
          variant: 'destructive',
        });
        return;
      }

      setIsCreatingEnv(true);
      try {
        const created = await createEnvironmentMutation.mutateAsync({
          name: newEnvName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          gitBranch: newEnvBranch.trim(),
          doAccountId: selectedDoAccountId,
        });
        environmentId = created.id;
      } catch {
        toast({
          title: 'Failed to create environment',
          description: 'Please check your inputs and try again.',
          variant: 'destructive',
        });
        setIsCreatingEnv(false);
        return;
      }
      setIsCreatingEnv(false);
    }

    if (!environmentId) return;

    setEnvDialogOpen(false);
    setIsSetupInProgress(true);
    setSetupStep('Analyzing your code with Railpack…');

    const doAccountId = envMode === 'create'
      ? selectedDoAccountId
      : environments?.find((e) => e.id === environmentId)?.doAccountId ?? doAccounts?.[0]?.id ?? '';

    try {
      await autoSetupMutation.mutateAsync({
        githubRepoId: selectedRepo.id,
        fullName: selectedRepo.fullName,
        branch: selectedRepo.defaultBranch,
        doAccountId,
        environmentId,
      });

      setSetupStep('Provisioning DigitalOcean infrastructure…');
      await queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });

      setSetupStep('Building your image…');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      toast({
        title: 'Deployment started',
        description: `${selectedRepo.fullName} is being deployed.`,
      });

      onSetupComplete?.();
    } catch {
      toast({
        title: 'Auto-deploy failed',
        description: 'Please check your repository and try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSetupInProgress(false);
      setSetupStep('');
    }
  };

  if (isSetupInProgress) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative">
            <Spinner className="h-12 w-12" />
            <Rocket className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-primary" />
          </div>
          <div>
            <p className="text-lg font-medium">{setupStep}</p>
            <p className="text-sm text-muted-foreground">This may take a few minutes…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="text-center">
            <Rocket className="mx-auto mb-3 h-10 w-10 text-primary" />
            <h2 className="text-xl font-semibold">Deploy your GitHub repo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Select a repository and we&apos;ll auto-detect your stack
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Repository</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search your repositories…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Recent repos</label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border">
              {reposLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="h-5 w-5" />
                </div>
              ) : filteredRepos && filteredRepos.length > 0 ? (
                filteredRepos.map((repo) => (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => setSelectedRepo(repo)}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                      selectedRepo?.id === repo.id && 'bg-accent',
                    )}
                  >
                    <span className="truncate font-medium">{repo.fullName}</span>
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">{repo.defaultBranch}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {searchQuery ? 'No repositories found' : 'No repositories available'}
                </p>
              )}
            </div>
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!selectedRepo}
            onClick={handleAutoDeployClick}
          >
            <Rocket className="mr-2 h-4 w-4" />
            Auto-Deploy
          </Button>
        </div>
      </div>

      <Dialog open={envDialogOpen} onOpenChange={setEnvDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Environment</DialogTitle>
            <DialogDescription>
              Choose an existing environment or create a new one for this deployment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {hasEnvironments && (
              <div className="flex gap-2">
                <Button
                  variant={envMode === 'select' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEnvMode('select')}
                >
                  Use Existing
                </Button>
                <Button
                  variant={envMode === 'create' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEnvMode('create')}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Create New
                </Button>
              </div>
            )}

            {envMode === 'select' && hasEnvironments ? (
              <div className="space-y-2">
                <Label>Environment</Label>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border">
                  {environments.map((env) => (
                    <button
                      key={env.id}
                      type="button"
                      onClick={() => setSelectedEnvId(env.id)}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                        selectedEnvId === env.id && 'bg-accent',
                      )}
                    >
                      <span className="font-medium">{env.name}</span>
                      <span className="text-xs text-muted-foreground">{env.gitBranch}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="env-name">Environment Name</Label>
                  <Input
                    id="env-name"
                    placeholder="e.g. production, staging"
                    value={newEnvName}
                    onChange={(e) => setNewEnvName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lowercase letters, numbers, and hyphens only
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="env-branch">Git Branch</Label>
                  <Input
                    id="env-branch"
                    placeholder="main"
                    value={newEnvBranch}
                    onChange={(e) => setNewEnvBranch(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>DigitalOcean Account</Label>
                  {doAccounts && doAccounts.length > 0 ? (
                    <Select value={selectedDoAccountId} onValueChange={setSelectedDoAccountId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an account" />
                      </SelectTrigger>
                      <SelectContent>
                        {doAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.region} &middot; {account.id.slice(0, 8)}…
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">No accounts connected</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEnvDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleEnvConfirmAndDeploy()}
              disabled={
                isCreatingEnv ||
                (envMode === 'select' && !selectedEnvId) ||
                (envMode === 'create' && (!newEnvName.trim() || !newEnvBranch.trim() || !selectedDoAccountId))
              }
            >
              {isCreatingEnv ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Creating…
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  Deploy
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
