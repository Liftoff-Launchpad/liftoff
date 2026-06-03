'use client';

import { Box, ChevronRight, Database, Github, Rocket, Search, Sparkles, Terminal, UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAutoSetup } from '@/hooks/queries/use-canvas';
import { useAvailableRepos } from '@/hooks/queries/use-repositories';
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

  const { data: availableRepos, isLoading: reposLoading } = useAvailableRepos(projectId);
  const autoSetupMutation = useAutoSetup(projectId);
  const queryClient = useQueryClient();

  const filteredRepos = availableRepos?.filter(
    (repo) =>
      repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleAutoDeployClick = async () => {
    if (!selectedRepo) return;

    setIsSetupInProgress(true);
    setSetupStep('Analyzing your code with Nixpacks…');

    try {
      await autoSetupMutation.mutateAsync({
        githubRepoId: selectedRepo.id,
        fullName: selectedRepo.fullName,
        branch: selectedRepo.defaultBranch,
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
      <div className="liftoff-canvas flex h-full w-full items-center justify-center">
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
      <div className="liftoff-canvas relative flex h-full w-full items-center justify-center overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(180deg,transparent,hsl(var(--primary)/0.08))]" />
        <div className="liftoff-panel w-full max-w-lg overflow-hidden rounded-lg">
          <div className="border-b border-border p-5">
            <h2 className="text-lg font-semibold">Deploy your first service</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a GitHub repository — Liftoff builds it and deploys to this project. Add
              databases and wire them on the canvas afterwards.
            </p>
          </div>

          <div className="space-y-3 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search GitHub repositories"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 border-border bg-background/60 pl-9"
              />
            </div>

            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border bg-background/30">
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
                      'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                      selectedRepo?.id === repo.id && 'bg-accent',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Github className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{repo.fullName}</span>
                    </span>
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">{repo.defaultBranch}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {searchQuery ? 'No repositories found' : 'No repositories available'}
                </p>
              )}
            </div>

            <Button className="w-full" size="lg" disabled={!selectedRepo} onClick={handleAutoDeployClick}>
              <Rocket className="mr-2 h-4 w-4" />
              Auto-deploy selected repo
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
