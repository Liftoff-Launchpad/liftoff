'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  type ConnectedRepository,
  useAvailableRepos,
  useConnectRepo,
  useConnectedRepos,
  useDisconnectRepoById,
} from '@/hooks/queries/use-repositories';

const connectRepositorySchema = z.object({
  githubRepoId: z.string().min(1, 'Select a repository'),
  branch: z
    .string()
    .min(1, 'Branch is required')
    .max(100, 'Maximum 100 characters')
    .regex(/^[A-Za-z0-9._/-]+$/, 'Only letters, numbers, ., _, / and - are allowed'),
});

type ConnectRepositoryValues = z.infer<typeof connectRepositorySchema>;

function resolveRouteParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) {
    return param[0] ?? '';
  }

  return param ?? '';
}

/**
 * Project repository settings — Phase F multi-repo: a project can link several
 * GitHub repos, each contributing services to one App. Lists every connected
 * repo and lets you add or remove them.
 */
export default function RepositoryPage(): JSX.Element {
  const params = useParams();
  const projectId = resolveRouteParam(params.id);
  const { data: availableRepositories, isLoading: isAvailableLoading } = useAvailableRepos(projectId);
  const { data: connectedRepositories, isLoading: isConnectedLoading } = useConnectedRepos(projectId);
  const connectRepositoryMutation = useConnectRepo(projectId);
  const disconnectRepositoryMutation = useDisconnectRepoById(projectId);

  const connectedGithubIds = new Set((connectedRepositories ?? []).map((repo) => repo.githubId));
  const connectableRepositories = (availableRepositories ?? []).filter(
    (repo) => !connectedGithubIds.has(repo.id),
  );

  const form = useForm<ConnectRepositoryValues>({
    resolver: zodResolver(connectRepositorySchema),
    defaultValues: {
      githubRepoId: '',
      branch: 'main',
    },
  });

  useEffect(() => {
    const selectable = (availableRepositories ?? []).filter(
      (repo) => !new Set((connectedRepositories ?? []).map((r) => r.githubId)).has(repo.id),
    );
    if (selectable.length === 0) {
      return;
    }
    const selectedRepositoryId = form.getValues('githubRepoId');
    const stillSelectable = selectable.some((repo) => String(repo.id) === selectedRepositoryId);
    if (!selectedRepositoryId || !stillSelectable) {
      const defaultRepository = selectable[0];
      if (!defaultRepository) {
        return;
      }
      form.setValue('githubRepoId', String(defaultRepository.id), { shouldValidate: true });
      form.setValue('branch', defaultRepository.defaultBranch, { shouldValidate: true });
    }
  }, [availableRepositories, connectedRepositories, form]);

  const handleConnectRepository = form.handleSubmit(async (values) => {
    const repositoryId = Number(values.githubRepoId);
    const selectedRepository = connectableRepositories.find((repo) => repo.id === repositoryId);
    if (!selectedRepository) {
      toast({
        title: 'Repository selection is invalid',
        description: 'Please choose a repository from the list.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await connectRepositoryMutation.mutateAsync({
        githubRepoId: selectedRepository.id,
        fullName: selectedRepository.fullName,
        branch: values.branch,
      });
      toast({
        title: 'Repository connected',
        description: `${selectedRepository.fullName} is now linked to this project.`,
      });
      form.reset({ githubRepoId: '', branch: 'main' });
    } catch {
      toast({
        title: 'Failed to connect repository',
        description: 'Please verify access and try again.',
        variant: 'destructive',
      });
    }
  });

  const handleDisconnectRepository = async (repository: ConnectedRepository): Promise<void> => {
    const confirmed = window.confirm(
      `Disconnect ${repository.fullName}? Its services stop auto-deploying; existing deployment history is kept.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await disconnectRepositoryMutation.mutateAsync(repository.id);
      toast({
        title: 'Repository disconnected',
        description: `${repository.fullName} is no longer linked.`,
      });
    } catch {
      toast({
        title: 'Failed to disconnect repository',
        description: 'Try again in a moment.',
        variant: 'destructive',
      });
    }
  };

  if (isConnectedLoading || isAvailableLoading) {
    return (
      <section className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </section>
    );
  }

  const repositories = connectedRepositories ?? [];

  return (
    <section className="space-y-6 p-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Repositories</h2>
        <p className="text-sm text-muted-foreground">
          Link one or more GitHub repositories. Each repo builds its own services into this
          project&apos;s App; a push only deploys that repo&apos;s services.
        </p>
      </div>

      {repositories.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Connected repositories ({repositories.length})</CardTitle>
            <CardDescription>
              The first (primary) repo adopts any services not explicitly assigned to a repo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {repositories.map((repository, index) => (
              <div
                key={repository.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-4 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{repository.fullName}</p>
                    {index === 0 && <Badge variant="secondary">Primary</Badge>}
                    <Badge
                      variant={repository.webhookStatus === 'active' ? 'secondary' : 'destructive'}
                    >
                      {repository.webhookStatus === 'active' ? 'Webhook active' : 'Webhook missing'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>branch: {repository.branch}</span>
                    <Link
                      href={repository.workflowUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center underline"
                    >
                      Workflow
                      <ArrowUpRight className="ml-0.5 h-3 w-3" />
                    </Link>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handleDisconnectRepository(repository)}
                  disabled={disconnectRepositoryMutation.isPending}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{repositories.length > 0 ? 'Add another repository' : 'Connect a repository'}</CardTitle>
          <CardDescription>
            Liftoff creates a webhook and commits a GitHub Actions workflow to the repo. Your
            DigitalOcean token is synced as <code>DIGITALOCEAN_ACCESS_TOKEN</code> in GitHub Secrets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void handleConnectRepository(event)} className="space-y-4">
            <div className="space-y-2">
              <Label>GitHub repository</Label>
              <Select
                value={form.watch('githubRepoId')}
                onValueChange={(value) => {
                  form.setValue('githubRepoId', value, { shouldValidate: true });
                  const selectedRepository = connectableRepositories.find(
                    (repository) => repository.id === Number(value),
                  );
                  if (selectedRepository) {
                    form.setValue('branch', selectedRepository.defaultBranch, {
                      shouldValidate: true,
                    });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select repository" />
                </SelectTrigger>
                <SelectContent>
                  {connectableRepositories.map((repository) => (
                    <SelectItem key={repository.id} value={String(repository.id)}>
                      {repository.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.githubRepoId?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.githubRepoId.message}</p>
              ) : null}
              {connectableRepositories.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {availableRepositories && availableRepositories.length > 0
                    ? 'All available repositories are already connected.'
                    : 'No GitHub repositories were found for this account.'}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="repository-branch">Branch</Label>
              <Input id="repository-branch" placeholder="main" {...form.register('branch')} />
              {form.formState.errors.branch?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.branch.message}</p>
              ) : null}
            </div>

            <Button
              type="submit"
              disabled={connectRepositoryMutation.isPending || connectableRepositories.length === 0}
            >
              {connectRepositoryMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Connect'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
