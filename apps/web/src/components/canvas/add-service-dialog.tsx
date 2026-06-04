'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import { useCreateService } from '@/hooks/queries/use-services';
import { useConnectedRepos } from '@/hooks/queries/use-repositories';

const buildStrategyOptions = ['AUTO', 'DOCKERFILE', 'NIXPACKS'] as const;
const instanceSizeOptions = [
  'apps-s-1vcpu-0.5gb',
  'apps-s-1vcpu-1gb',
  'apps-s-2vcpu-2gb',
  'apps-s-2vcpu-4gb',
  'apps-s-4vcpu-8gb',
] as const;

const jobKindOptions = ['post_deploy', 'pre_deploy', 'failed_deploy', 'cron'] as const;

const schema = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, numbers, hyphens only'),
  kind: z.enum(['SERVICE', 'WORKER', 'JOB', 'STATIC_SITE']).default('SERVICE'),
  sourceDir: z.string().min(1).default('.'),
  buildStrategy: z.enum(buildStrategyOptions).default('AUTO'),
  dockerfilePath: z.string().min(1).default('Dockerfile'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  instanceSize: z.enum(instanceSizeOptions).default('apps-s-1vcpu-0.5gb'),
  replicas: z.coerce.number().int().min(1).max(20).default(1),
  routePath: z.string().default(''),
  healthcheckPath: z.string().default(''),
  command: z.string().default(''),
  jobKind: z.enum(jobKindOptions).default('post_deploy'),
  jobSchedule: z.string().default(''),
  repositoryId: z.string().default(''),
});

type FormValues = z.input<typeof schema>;

/** Web services and static sites are served over HTTP and get a route + healthcheck. */
function isHttpKind(kind: FormValues['kind']): boolean {
  return kind === 'SERVICE' || kind === 'STATIC_SITE';
}

interface AddServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: string;
  projectId: string;
}

/**
 * Modal dialog that POSTs a new Service to the env. After success, the canvas
 * query is invalidated and the new node appears.
 */
export function AddServiceDialog({
  open,
  onOpenChange,
  environmentId,
  projectId,
}: AddServiceDialogProps) {
  const createServiceMutation = useCreateService(environmentId, projectId);
  const { data: repositories } = useConnectedRepos(projectId);
  // Only offer a repo picker when the project links more than one repo; with a
  // single repo the backend defaults to it.
  const showRepoPicker = (repositories?.length ?? 0) > 1;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      kind: 'SERVICE',
      sourceDir: '.',
      buildStrategy: 'AUTO',
      dockerfilePath: 'Dockerfile',
      port: 3000,
      instanceSize: 'apps-s-1vcpu-0.5gb',
      replicas: 1,
      routePath: '',
      healthcheckPath: '',
      command: '',
      jobKind: 'post_deploy',
      jobSchedule: '',
      repositoryId: '',
    },
  });

  const handleSubmit = form.handleSubmit(async (raw) => {
    const values = schema.parse(raw);
    try {
      await createServiceMutation.mutateAsync({
        name: values.name,
        kind: values.kind,
        sourceDir: values.sourceDir,
        buildStrategy: values.buildStrategy,
        dockerfilePath: values.dockerfilePath,
        port: values.port,
        instanceSize: values.instanceSize,
        replicas: values.replicas,
        // Routes/healthcheck are HTTP-only — web services and static sites get
        // them; workers and jobs don't.
        ...(isHttpKind(values.kind) && values.routePath ? { routePath: values.routePath } : {}),
        ...(isHttpKind(values.kind) && values.healthcheckPath
          ? { healthcheckPath: values.healthcheckPath }
          : {}),
        ...(values.command ? { command: values.command } : {}),
        // Job lifecycle fields only apply to JOB components.
        ...(values.kind === 'JOB' ? { jobKind: values.jobKind } : {}),
        ...(values.kind === 'JOB' && values.jobSchedule
          ? { jobSchedule: values.jobSchedule }
          : {}),
        // Which repo builds this service (multi-repo projects only).
        ...(values.repositoryId ? { repositoryId: values.repositoryId } : {}),
      });
      toast({
        title: 'Service added',
        description: `${values.name} will build on the next deploy.`,
      });
      form.reset();
      onOpenChange(false);
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast({
        title: 'Failed to add service',
        description: message ?? 'Check the inputs and try again.',
        variant: 'destructive',
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Service</DialogTitle>
          <DialogDescription>
            New component for this environment&apos;s App Platform app. Builds on the next
            push or manual deploy.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label htmlFor="svc-name">Name</Label>
              <Input id="svc-name" placeholder="api" {...form.register('name')} />
              {form.formState.errors.name?.message && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1 col-span-2">
              <Label>Type</Label>
              <Select
                value={form.watch('kind')}
                onValueChange={(value) =>
                  form.setValue('kind', value as FormValues['kind'], { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SERVICE">Web service (HTTP, public route)</SelectItem>
                  <SelectItem value="WORKER">Worker (background, no route)</SelectItem>
                  <SelectItem value="JOB">Job (deploy hook / task)</SelectItem>
                  <SelectItem value="STATIC_SITE">Static site (served as container)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showRepoPicker && (
              <div className="space-y-1 col-span-2">
                <Label>Repository</Label>
                <Select
                  value={form.watch('repositoryId')}
                  onValueChange={(value) =>
                    form.setValue('repositoryId', value, { shouldValidate: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Primary repository" />
                  </SelectTrigger>
                  <SelectContent>
                    {repositories?.map((repo) => (
                      <SelectItem key={repo.id} value={repo.id}>
                        {repo.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Which connected repo builds this service. Empty = primary.
                </p>
              </div>
            )}

            <div className="space-y-1 col-span-2">
              <Label htmlFor="svc-source">Source folder (within repo)</Label>
              <Input id="svc-source" placeholder="." {...form.register('sourceDir')} />
            </div>

            <div className="space-y-1">
              <Label>Build strategy</Label>
              <Select
                value={form.watch('buildStrategy')}
                onValueChange={(value) =>
                  form.setValue('buildStrategy', value as FormValues['buildStrategy'], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {buildStrategyOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="svc-port">Port</Label>
              <Input id="svc-port" type="number" {...form.register('port')} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="svc-dockerfile">Dockerfile path</Label>
              <Input
                id="svc-dockerfile"
                placeholder="Dockerfile"
                {...form.register('dockerfilePath')}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="svc-replicas">Replicas</Label>
              <Input id="svc-replicas" type="number" {...form.register('replicas')} />
            </div>

            <div className="space-y-1 col-span-2">
              <Label>Instance size</Label>
              <Select
                value={form.watch('instanceSize')}
                onValueChange={(value) =>
                  form.setValue('instanceSize', value as FormValues['instanceSize'], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {instanceSizeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isHttpKind(form.watch('kind')) && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="svc-route">Route path</Label>
                  <Input id="svc-route" placeholder="/api" {...form.register('routePath')} />
                  <p className="text-xs text-muted-foreground">Empty = auto (/&lt;name&gt;)</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="svc-health">Healthcheck path</Label>
                  <Input
                    id="svc-health"
                    placeholder="/health"
                    {...form.register('healthcheckPath')}
                  />
                  <p className="text-xs text-muted-foreground">Empty = TCP probe</p>
                </div>
              </>
            )}

            {form.watch('kind') === 'JOB' && (
              <>
                <div className="space-y-1">
                  <Label>Job runs</Label>
                  <Select
                    value={form.watch('jobKind')}
                    onValueChange={(value) =>
                      form.setValue('jobKind', value as FormValues['jobKind'], {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="post_deploy">After each deploy (post-deploy)</SelectItem>
                      <SelectItem value="pre_deploy">Before each deploy (pre-deploy)</SelectItem>
                      <SelectItem value="failed_deploy">On failed deploy</SelectItem>
                      <SelectItem value="cron">On a schedule (best-effort)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="svc-schedule">Schedule (cron)</Label>
                  <Input
                    id="svc-schedule"
                    placeholder="0 3 * * *"
                    disabled={form.watch('jobKind') !== 'cron'}
                    {...form.register('jobSchedule')}
                  />
                  <p className="text-xs text-muted-foreground">
                    App Platform has no native cron; recorded for export.
                  </p>
                </div>
              </>
            )}

            <div className="space-y-1 col-span-2">
              <Label htmlFor="svc-command">Start command</Label>
              <Input
                id="svc-command"
                placeholder="node server.js"
                {...form.register('command')}
              />
              <p className="text-xs text-muted-foreground">
                Empty = auto-detect. Set this if the build fails with “No start command”.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createServiceMutation.isPending}>
              {createServiceMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Add service'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
