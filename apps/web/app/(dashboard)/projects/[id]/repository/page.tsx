'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUpRight } from 'lucide-react';
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
  useAvailableRepos,
  useConnectRepo,
  useConnectedRepo,
  useDisconnectRepo,
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
 * Project repository connection settings page.
 */
export default function RepositoryPage(): JSX.Element {
  const params = useParams();
  const projectId = resolveRouteParam(params.id);
  const { data: availableRepositories, isLoading: isAvailableLoading } = useAvailableRepos(projectId);
  const { data: connectedRepository, isLoading: isConnectedLoading } = useConnectedRepo(projectId);
  const connectRepositoryMutation = useConnectRepo(projectId);
  const disconnectRepositoryMutation = useDisconnectRepo(projectId);

  const form = useForm<ConnectRepositoryValues>({
    resolver: zodResolver(connectRepositorySchema),
    defaultValues: {
      githubRepoId: '',
      branch: 'main',
    },
  });

  useEffect(() => {
    if (!availableRepositories || availableRepositories.length === 0) {
      return;
    }

    const selectedRepositoryId = form.getValues('githubRepoId');
    if (!selectedRepositoryId) {
      const defaultRepository = availableRepositories[0];
      if (!defaultRepository) {
        return;
      }
      form.setValue('githubRepoId', String(defaultRepository.id), {
        shouldValidate: true,
      });
      form.setValue('branch', defaultRepository.defaultBranch, {
        shouldValidate: true,
      });
    }
  }, [availableRepositories, form]);

  const handleConnectRepository = form.handleSubmit(async (values) => {
    const repositoryId = Number(values.githubRepoId);
    const selectedRepository = availableRepositories?.find((repo) => repo.id === repositoryId);
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
        description: `${selectedRepository.fullName} is now connected.`,
      });
    } catch {
      toast({
        title: 'Failed to connect repository',
        description: 'Please verify access and try again.',
        variant: 'destructive',
      });
    }
  });

  const handleDisconnectRepository = async (): Promise<void> => {
    const confirmed = window.confirm(
      'Disconnect this repository from the project? Existing deployments remain in history.',
    );
    if (!confirmed) {
      return;
    }

    try {
      await disconnectRepositoryMutation.mutateAsync();
      toast({
        title: 'Repository disconnected',
        description: 'The project is no longer connected to GitHub.',
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

  return (
    <section className="space-y-6 p-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Repository</h2>
        <p className="text-sm text-muted-foreground">
          Connect a GitHub repository so Liftoff can trigger deployments on push.
        </p>
      </div>

      {!connectedRepository ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect repository</CardTitle>
            <CardDescription>
              Liftoff will create a webhook and commit a GitHub Actions workflow to your repository.
              Add your DigitalOcean token as <code>DIGITALOCEAN_ACCESS_TOKEN</code> in GitHub Secrets.
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
                    const selectedRepository = availableRepositories?.find(
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
                    {availableRepositories?.map((repository) => (
                      <SelectItem key={repository.id} value={String(repository.id)}>
                        {repository.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.githubRepoId?.message ? (
                  <p className="text-xs text-destructive">{form.formState.errors.githubRepoId.message}</p>
                ) : null}
                {!availableRepositories || availableRepositories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No GitHub repositories were found for this account.
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
                disabled={connectRepositoryMutation.isPending || !availableRepositories?.length}
              >
                {connectRepositoryMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Connect'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connected repository</CardTitle>
            <CardDescription>
              Liftoff is watching this branch for push events.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Repository</p>
                <p className="text-sm font-medium">{connectedRepository.fullName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Branch</p>
                <p className="text-sm font-medium">{connectedRepository.branch}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Webhook</p>
                <Badge variant={connectedRepository.webhookStatus === 'active' ? 'secondary' : 'destructive'}>
                  {connectedRepository.webhookStatus === 'active' ? 'Active' : 'Missing'}
                </Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Workflow</p>
                <Link
                  href={connectedRepository.workflowUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center text-sm underline"
                >
                  View Workflow
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <Button
              variant="destructive"
              onClick={() => void handleDisconnectRepository()}
              disabled={disconnectRepositoryMutation.isPending}
            >
              {disconnectRepositoryMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Disconnect'}
            </Button>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
