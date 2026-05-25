'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ArrowUpRight, Bell, FileText, Gauge, Layers3, Rocket, Settings, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/use-toast';
import { useProject, useUpdateProject, useDeleteProject } from '@/hooks/queries/use-projects';
import { useConnectedRepo } from '@/hooks/queries/use-repositories';
import { cn } from '@/lib/utils';

const projectSettingsSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100, 'Maximum 100 characters'),
  description: z.string().max(500, 'Maximum 500 characters').optional(),
});

type ProjectSettingsValues = z.infer<typeof projectSettingsSchema>;

function resolveRouteParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

export default function ProjectSettingsPage(): JSX.Element {
  const params = useParams();
  const router = useRouter();
  const projectId = resolveRouteParam(params.id);

  const { data: project, isLoading } = useProject(projectId);
  const { data: connectedRepo } = useConnectedRepo(projectId);
  const updateProjectMutation = useUpdateProject();
  const deleteProjectMutation = useDeleteProject();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const form = useForm<ProjectSettingsValues>({
    resolver: zodResolver(projectSettingsSchema),
    values: project
      ? { name: project.name, description: project.description ?? '' }
      : { name: '', description: '' },
  });

  const handleSave = form.handleSubmit(async (values) => {
    try {
      await updateProjectMutation.mutateAsync({
        id: projectId,
        name: values.name,
        description: values.description || undefined,
      });
      toast({ title: 'Project updated', description: 'Your changes have been saved.' });
    } catch {
      toast({ title: 'Update failed', description: 'Please try again.', variant: 'destructive' });
    }
  });

  const handleDelete = async (): Promise<void> => {
    try {
      await deleteProjectMutation.mutateAsync(projectId);
      toast({ title: 'Project deleted', description: 'The project has been removed.' });
      router.push('/projects');
    } catch {
      toast({ title: 'Delete failed', description: 'Please try again.', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <section className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </section>
    );
  }

  if (!project) {
    return (
      <section className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Project not found.</p>
      </section>
    );
  }

  const canDelete = deleteConfirmName === project.name;

  return (
    <section className="min-h-full p-0">
      <div className="mx-auto flex min-h-full max-w-[1800px] flex-col px-6 py-5">
        <div className="liftoff-panel min-h-[calc(100vh-40px)] overflow-hidden rounded-lg">
          <header className="flex h-28 items-center justify-between border-b border-border px-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-primary">Launch settings</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Project Settings</h2>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <Bell className="h-4 w-4" />
              <Link href={`/projects/${projectId}/canvas`} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary">
                <Rocket className="h-4 w-4" />
                Canvas
              </Link>
            </div>
          </header>

          <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-10 px-8 py-10">
            <nav className="space-y-2 text-sm">
              {[
                { label: 'General', icon: Settings, active: true },
                { label: 'Usage', icon: Gauge },
                { label: 'Environments', icon: Layers3 },
                { label: 'Logs', icon: FileText },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left',
                      item.active ? 'text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('h-4 w-4', item.active && 'text-primary')} />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div className="max-w-4xl space-y-8">
              <div>
                <h3 className="text-2xl font-semibold">Project Info</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Manage general settings for <span className="font-medium text-foreground">{project.name}</span>.
                </p>
              </div>

      <Card className="border-border bg-background/30 shadow-none">
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Update your project name and description.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input id="project-name" {...form.register('name')} />
              {form.formState.errors.name?.message && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">Description</Label>
              <Input id="project-description" placeholder="Optional description" {...form.register('description')} />
              {form.formState.errors.description?.message && (
                <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
              )}
            </div>
            <Button type="submit" disabled={updateProjectMutation.isPending}>
              {updateProjectMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Save changes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border bg-background/30 shadow-none">
        <CardHeader>
          <CardTitle>Repository</CardTitle>
          <CardDescription>The GitHub repository connected to this project.</CardDescription>
        </CardHeader>
        <CardContent>
          {connectedRepo ? (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">{connectedRepo.fullName}</p>
                <p className="text-xs text-muted-foreground">Branch: {connectedRepo.branch}</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/projects/${projectId}/repository`}>
                  Manage
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">No repository connected.</p>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/projects/${projectId}/repository`}>Connect</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-background/30 shadow-none">
        <CardHeader>
          <CardTitle>Environments</CardTitle>
          <CardDescription>Environments provisioned for this project.</CardDescription>
        </CardHeader>
        <CardContent>
          {project.environments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No environments created yet.</p>
          ) : (
            <div className="space-y-2">
              {project.environments.map((env) => (
                <div key={env.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{env.name}</span>
                    <Badge variant="secondary" className="text-xs">{env.serviceType}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">Branch: {env.gitBranch}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50 bg-background/30 shadow-none">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Deleting a project is permanent. All environments, deployments, and history will be removed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="mr-1 h-4 w-4" />
            Delete project
          </Button>
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Type <span className="font-semibold text-foreground">{project.name}</span> to
              confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder={project.name}
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canDelete || deleteProjectMutation.isPending}
              onClick={() => void handleDelete()}
            >
              {deleteProjectMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
