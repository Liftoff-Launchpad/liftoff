'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { GitBranch, Github, Grid2X2, Layers3, List, Plus, Rocket, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { toast } from '@/components/ui/use-toast';
import { useCreateProject, useProjects, type ProjectListItem } from '@/hooks/queries/use-projects';
import { useAvailableRepos, type AvailableRepository } from '@/hooks/queries/use-repositories';
import { useCreateEnvironment } from '@/hooks/queries/use-environments';
import { useDoAccounts } from '@/hooks/queries/use-do-accounts';
import { useAutoSetup } from '@/hooks/queries/use-canvas';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

const createProjectSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(40, 'Name must be at most 40 characters')
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, numbers, hyphens only'),
  description: z.string().max(500).optional().default(''),
});

type CreateProjectValues = z.infer<typeof createProjectSchema>;
type FlowStep = 'name' | 'repo' | 'env' | 'deploying';

const PAGE_SIZE = 12;

function ProjectTile({ project }: { project: ProjectListItem }): JSX.Element {
  return (
    <Link
      href={`/projects/${project.id}/canvas`}
      className="group relative min-h-44 rounded-lg border border-border bg-card/60 p-5 transition-colors hover:border-primary/60 hover:bg-secondary/60"
    >
      <div className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/70 text-muted-foreground group-hover:text-primary">
        <Rocket className="h-4 w-4" />
      </div>
      <div className="flex h-full flex-col justify-between gap-6">
        <div className="space-y-2 pr-10">
          <h3 className="truncate text-base font-semibold">{project.name}</h3>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {project.description || 'Ready for a launch sequence.'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Layers3 className="h-3.5 w-3.5" />
            {project._count.environments} env{project._count.environments === 1 ? '' : 's'}
          </span>
          <span>Updated {new Date(project.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </Link>
  );
}

export default function ProjectsPage(): JSX.Element {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<FlowStep>('name');
  const [createdProjectId, setCreatedProjectId] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<AvailableRepository | null>(null);
  const [envName, setEnvName] = useState('production');
  const [envBranch, setEnvBranch] = useState('main');
  const [selectedDoAccountId, setSelectedDoAccountId] = useState('');
  const [deployStep, setDeployStep] = useState('');

  const { data, isLoading } = useProjects(page, PAGE_SIZE);
  const createProjectMutation = useCreateProject();
  const { data: doAccounts } = useDoAccounts();
  const queryClient = useQueryClient();

  const { data: availableRepos, isLoading: reposLoading } = useAvailableRepos(createdProjectId);
  const createEnvMutation = useCreateEnvironment(createdProjectId);
  const autoSetupMutation = useAutoSetup(createdProjectId);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const form = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: '', description: '' },
  });

  const filteredRepos = availableRepos?.filter(
    (r) =>
      r.fullName.toLowerCase().includes(repoSearch.toLowerCase()) ||
      r.name.toLowerCase().includes(repoSearch.toLowerCase()),
  );

  const resetFlow = (): void => {
    setStep('name');
    setCreatedProjectId('');
    setSelectedRepo(null);
    setRepoSearch('');
    setEnvName('production');
    setEnvBranch('main');
    setSelectedDoAccountId('');
    setDeployStep('');
    form.reset();
  };

  const handleCreateProject = form.handleSubmit(async (values) => {
    try {
      const project = await createProjectMutation.mutateAsync({
        name: values.name,
        description: values.description || undefined,
      });
      setCreatedProjectId(project.id);
      setStep('repo');
    } catch {
      toast({ title: 'Failed to create project', variant: 'destructive' });
    }
  });

  const handleSelectRepo = (repo: AvailableRepository): void => {
    setSelectedRepo(repo);
    setEnvBranch(repo.defaultBranch);
    setEnvName(repo.defaultBranch === 'main' ? 'production' : repo.defaultBranch);
    if (doAccounts && doAccounts.length > 0 && doAccounts[0]) {
      setSelectedDoAccountId(doAccounts[0].id);
    }
    setStep('env');
  };

  const handleDeploy = async (): Promise<void> => {
    if (!selectedRepo || !selectedDoAccountId || !createdProjectId) return;

    setStep('deploying');
    setDeployStep('Creating launch environment...');

    let envId: string;
    try {
      const env = await createEnvMutation.mutateAsync({
        name: envName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        gitBranch: envBranch.trim(),
        doAccountId: selectedDoAccountId,
      });
      envId = env.id;
    } catch {
      toast({ title: 'Failed to create environment', description: 'Please try again.', variant: 'destructive' });
      setStep('env');
      return;
    }

    setDeployStep('Preparing DigitalOcean launchpad...');
    try {
      await autoSetupMutation.mutateAsync({
        githubRepoId: selectedRepo.id,
        fullName: selectedRepo.fullName,
        branch: envBranch,
        doAccountId: selectedDoAccountId,
        environmentId: envId,
      });
    } catch {
      toast({ title: 'Deployment failed', description: 'Please try again.', variant: 'destructive' });
      setStep('env');
      return;
    }

    setDeployStep('Deployment queued. Opening canvas...');
    queryClient.invalidateQueries({ queryKey: ['projects'] }).catch(() => {});
    toast({ title: 'Deployment started', description: `${selectedRepo.fullName} is on the pad.` });

    setOpen(false);
    resetFlow();
    router.push(`/projects/${createdProjectId}/canvas`);
  };

  return (
    <section className="min-h-full p-0">
      <div className="mx-auto flex min-h-full max-w-[1800px] flex-col px-6 py-5">
        <div className="liftoff-panel relative flex min-h-[calc(100vh-40px)] flex-col overflow-hidden rounded-lg">
          <div className="flex items-center justify-between border-b border-border/80 px-8 py-6">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-primary">Mission control</p>
              <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
            </div>
            <Dialog
              open={open}
              onOpenChange={(v) => {
                setOpen(v);
                if (!v) resetFlow();
              }}
            >
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  New
                </Button>
              </DialogTrigger>
              <DialogContent className="border-border bg-popover sm:max-w-lg">
                {step === 'name' && (
                  <>
                    <DialogHeader>
                      <DialogTitle>Create project</DialogTitle>
                      <DialogDescription>Give this launch a stable callsign. Repository setup comes next.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={(e) => void handleCreateProject(e)} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="proj-name">Project name</Label>
                        <Input id="proj-name" placeholder="orbital-api" {...form.register('name')} />
                        {form.formState.errors.name?.message && (
                          <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proj-desc">Description</Label>
                        <Input id="proj-desc" placeholder="Optional" {...form.register('description')} />
                      </div>
                      <DialogFooter>
                        <Button type="submit" disabled={createProjectMutation.isPending}>
                          {createProjectMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Continue'}
                        </Button>
                      </DialogFooter>
                    </form>
                  </>
                )}

                {step === 'repo' && (
                  <>
                    <DialogHeader>
                      <DialogTitle>Connect repository</DialogTitle>
                      <DialogDescription>Select a GitHub repository to put on the canvas.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Search repositories..."
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background/40">
                        {reposLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Spinner className="h-5 w-5" />
                          </div>
                        ) : filteredRepos && filteredRepos.length > 0 ? (
                          filteredRepos.map((repo) => (
                            <button
                              key={repo.id}
                              type="button"
                              onClick={() => handleSelectRepo(repo)}
                              className="flex w-full items-center justify-between px-3 py-3 text-left text-sm transition-colors hover:bg-accent"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <Github className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="truncate font-medium">{repo.fullName}</span>
                              </span>
                              <span className="ml-3 shrink-0 text-xs text-muted-foreground">{repo.defaultBranch}</span>
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                            {repoSearch ? 'No repositories found' : 'No repositories available'}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {step === 'env' && (
                  <>
                    <DialogHeader>
                      <DialogTitle>Configure environment</DialogTitle>
                      <DialogDescription>Choose the branch and DigitalOcean account for {selectedRepo?.fullName}.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Environment name</Label>
                        <Input value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="production" />
                      </div>
                      <div className="space-y-2">
                        <Label>Git branch</Label>
                        <Input value={envBranch} onChange={(e) => setEnvBranch(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>DigitalOcean account</Label>
                        {doAccounts && doAccounts.length > 0 ? (
                          <Select value={selectedDoAccountId} onValueChange={setSelectedDoAccountId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select account" />
                            </SelectTrigger>
                            <SelectContent>
                              {doAccounts.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.region} / {a.id.slice(0, 8)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-sm text-destructive">No DO accounts connected. Go to Settings first.</p>
                        )}
                      </div>
                    </div>
                    <DialogFooter className="gap-2">
                      <Button variant="outline" onClick={() => setStep('repo')}>
                        Back
                      </Button>
                      <Button
                        onClick={() => void handleDeploy()}
                        disabled={!envName.trim() || !envBranch.trim() || !selectedDoAccountId}
                      >
                        <Rocket className="mr-2 h-4 w-4" />
                        Deploy
                      </Button>
                    </DialogFooter>
                  </>
                )}

                {step === 'deploying' && (
                  <div className="flex flex-col items-center gap-4 py-10 text-center">
                    <div className="relative">
                      <Spinner className="h-12 w-12" />
                      <Rocket className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-primary" />
                    </div>
                    <div>
                      <p className="text-lg font-medium">{deployStep}</p>
                      <p className="text-sm text-muted-foreground">This may take a moment.</p>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex items-center justify-between px-8 py-5 text-sm">
            <div className="flex items-center gap-4 text-muted-foreground">
              <span className="inline-flex items-center gap-2 text-foreground">
                <Grid2X2 className="h-4 w-4 text-muted-foreground" />
                {total} Project{total === 1 ? '' : 's'}
              </span>
              <span className="h-5 w-px bg-border" />
              <span>Sort by recent activity</span>
            </div>
            <div className="flex rounded-lg border border-border bg-secondary/60 p-1">
              <button className="flex h-8 w-8 items-center justify-center rounded-md bg-background text-foreground" type="button">
                <Grid2X2 className="h-4 w-4" />
              </button>
              <button className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground" type="button">
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center px-8 pb-8">
            {isLoading ? (
              <Spinner className="h-8 w-8" />
            ) : !data || data.data.length === 0 ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="group flex min-h-[52vh] w-full max-w-5xl items-center justify-center rounded-lg border border-dashed border-border bg-background/20 text-left transition-colors hover:border-primary/50 hover:bg-secondary/30"
              >
                <div className="flex items-center gap-8">
                  <div className="relative flex h-28 w-36 items-center justify-center rounded-lg border border-primary/50 bg-primary/10 text-primary shadow-[0_0_80px_hsl(var(--primary)/0.18)]">
                    <div className="absolute inset-y-0 -left-24 w-24 rounded-l-full border-l border-primary/15" />
                    <div className="grid grid-cols-2 gap-2">
                      <span className="flex h-10 w-12 items-center justify-center rounded-md border border-primary/50 bg-background/70">
                        <Github className="h-5 w-5" />
                      </span>
                      <span className="flex h-10 w-12 items-center justify-center rounded-md border border-primary/50 bg-background/70">
                        <Rocket className="h-5 w-5" />
                      </span>
                      <span className="flex h-10 w-12 items-center justify-center rounded-md border border-primary/50 bg-background/70">
                        <Layers3 className="h-5 w-5" />
                      </span>
                      <span className="flex h-10 w-12 items-center justify-center rounded-md border border-primary/50 bg-background/70">
                        <Plus className="h-5 w-5" />
                      </span>
                    </div>
                  </div>
                  <div className="max-w-md">
                    <h2 className="text-xl font-semibold">Create a new launch</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Deploy a GitHub repository, create an empty canvas, or stage future services as endpoints.
                    </p>
                    <span className="mt-4 inline-flex items-center gap-2 text-sm text-primary">
                      <Sparkles className="h-4 w-4" />
                      Open launch menu
                    </span>
                  </div>
                </div>
              </button>
            ) : (
              <div className="w-full space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {data.data.map((project) => (
                    <ProjectTile key={project.id} project={project} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {page} / {totalPages}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                      Next
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
