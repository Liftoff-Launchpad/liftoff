'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Circle, GitBranch, Plus, Rocket, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  description: z
    .string()
    .max(500)
    .optional()
    .default(''),
});

type CreateProjectValues = z.infer<typeof createProjectSchema>;

type FlowStep = 'name' | 'repo' | 'env' | 'deploying';

const PAGE_SIZE = 12;

function ProjectCard({ project }: { project: ProjectListItem }) {
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="group h-full border-border/50 bg-card/50 transition-all hover:border-primary/30 hover:bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Rocket className="h-4 w-4" />
            </div>
            <CardTitle className="text-base">{project.name}</CardTitle>
          </div>
          <CardDescription className="line-clamp-2 text-xs">
            {project.description || 'No description'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
            {project._count.environments} env{project._count.environments === 1 ? '' : 's'}
          </span>
        </CardContent>
      </Card>
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

  const resetFlow = () => {
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

  const handleSelectRepo = (repo: AvailableRepository) => {
    setSelectedRepo(repo);
    setEnvBranch(repo.defaultBranch);
    setEnvName(repo.defaultBranch === 'main' ? 'production' : repo.defaultBranch);
    if (doAccounts && doAccounts.length > 0 && doAccounts[0]) {
      setSelectedDoAccountId(doAccounts[0].id);
    }
    setStep('env');
  };

  const handleDeploy = async () => {
    if (!selectedRepo || !selectedDoAccountId) return;

    const projectId = createdProjectId;
    if (!projectId) return;

    setStep('deploying');
    setDeployStep('Creating environment...');

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

    setDeployStep('Connecting repo and starting deployment...');
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

    setDeployStep('Deployment queued! Redirecting...');
    queryClient.invalidateQueries({ queryKey: ['projects'] }).catch(() => {});
    toast({ title: 'Deployment started', description: `${selectedRepo.fullName} is being deployed.` });

    setOpen(false);
    resetFlow();
    router.push(`/projects/${projectId}/canvas`);
  };

  return (
    <section className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Projects</h2>
          <p className="text-sm text-muted-foreground">Your deployed applications.</p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) resetFlow();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            {step === 'name' && (
              <>
                <DialogHeader>
                  <DialogTitle>Create project</DialogTitle>
                  <DialogDescription>
                    Give your project a name. You&apos;ll connect a repo next.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={(e) => void handleCreateProject(e)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="proj-name">Project name</Label>
                    <Input id="proj-name" placeholder="my-webapp" {...form.register('name')} />
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
                  <DialogDescription>
                    Select a GitHub repository to deploy.
                  </DialogDescription>
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
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
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
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                        >
                          <div className="flex items-center gap-2">
                            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{repo.fullName}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{repo.defaultBranch}</span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
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
                  <DialogDescription>
                    Set up the environment for {selectedRepo?.fullName}.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Environment name</Label>
                    <Input
                      value={envName}
                      onChange={(e) => setEnvName(e.target.value)}
                      placeholder="production"
                    />
                    <p className="text-xs text-muted-foreground">Lowercase, numbers, hyphens only</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Git branch</Label>
                    <Input
                      value={envBranch}
                      onChange={(e) => setEnvBranch(e.target.value)}
                    />
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
                              {a.region} &middot; {a.id.slice(0, 8)}...
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-destructive">
                        No DO accounts connected. Go to Settings first.
                      </p>
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
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="relative">
                  <Spinner className="h-12 w-12" />
                  <Rocket className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-primary" />
                </div>
                <div>
                  <p className="text-lg font-medium">{deployStep}</p>
                  <p className="text-sm text-muted-foreground">This may take a moment...</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex min-h-[35vh] items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-center">
            <Rocket className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
            <h3 className="text-lg font-medium">No projects yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first project to start deploying.
            </p>
            <Button className="mt-4" onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.data.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
