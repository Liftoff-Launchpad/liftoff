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

const buildStrategyOptions = ['AUTO', 'DOCKERFILE', 'NIXPACKS'] as const;
const instanceSizeOptions = [
  'apps-s-1vcpu-0.5gb',
  'apps-s-1vcpu-1gb',
  'apps-s-2vcpu-2gb',
  'apps-s-2vcpu-4gb',
  'apps-s-4vcpu-8gb',
] as const;

const schema = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, numbers, hyphens only'),
  sourceDir: z.string().min(1).default('.'),
  buildStrategy: z.enum(buildStrategyOptions).default('AUTO'),
  dockerfilePath: z.string().min(1).default('Dockerfile'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  instanceSize: z.enum(instanceSizeOptions).default('apps-s-1vcpu-0.5gb'),
  replicas: z.coerce.number().int().min(1).max(20).default(1),
  routePath: z.string().default(''),
  healthcheckPath: z.string().default(''),
});

type FormValues = z.input<typeof schema>;

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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      sourceDir: '.',
      buildStrategy: 'AUTO',
      dockerfilePath: 'Dockerfile',
      port: 3000,
      instanceSize: 'apps-s-1vcpu-0.5gb',
      replicas: 1,
      routePath: '',
      healthcheckPath: '',
    },
  });

  const handleSubmit = form.handleSubmit(async (raw) => {
    const values = schema.parse(raw);
    try {
      await createServiceMutation.mutateAsync({
        name: values.name,
        sourceDir: values.sourceDir,
        buildStrategy: values.buildStrategy,
        dockerfilePath: values.dockerfilePath,
        port: values.port,
        instanceSize: values.instanceSize,
        replicas: values.replicas,
        // Route/healthcheck: empty string means "leave default", which the API
        // resolves to "/<name>" for non-first services and a TCP probe respectively.
        ...(values.routePath ? { routePath: values.routePath } : {}),
        ...(values.healthcheckPath ? { healthcheckPath: values.healthcheckPath } : {}),
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
