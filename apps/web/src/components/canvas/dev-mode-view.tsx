'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/use-toast';
import {
  useEnvironment,
  useUpdateConfig,
  useValidateConfig,
} from '@/hooks/queries/use-environments';
import { cn } from '@/lib/utils';
import { DrawerMetricsTab } from './config-drawer/drawer-metrics-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const configSchema = z.object({
  configYaml: z.string().min(1, 'Configuration YAML is required'),
});

type ConfigValues = z.infer<typeof configSchema>;

const defaultConfig = `version: "1.0"
service:
  name: test-app
  type: app
  region: nyc3
runtime:
  instance_size: apps-s-1vcpu-0.5gb
  port: 3000
  replicas: 1
healthcheck:
  path: /`;

interface DevModeViewProps {
  projectId: string;
  environmentId: string;
}

export function DevModeView({ projectId, environmentId }: DevModeViewProps) {
  const { data: environment, isLoading } = useEnvironment(projectId, environmentId);
  const updateConfigMutation = useUpdateConfig(projectId);
  const validateConfigMutation = useValidateConfig(projectId);

  const form = useForm<ConfigValues>({
    resolver: zodResolver(configSchema),
    defaultValues: { configYaml: defaultConfig },
  });

  useEffect(() => {
    if (environment?.configYaml) {
      form.setValue('configYaml', environment.configYaml);
    }
  }, [environment?.configYaml, form]);

  const handleValidateConfig = async (): Promise<void> => {
    const values = form.getValues();
    const result = await validateConfigMutation.mutateAsync({
      id: environmentId,
      configYaml: values.configYaml,
    });

    if (result.valid) {
      toast({ title: 'Config is valid', description: 'No validation errors found in liftoff.yml.' });
      return;
    }

    const firstError = result.errors?.[0];
    toast({
      title: 'Config validation failed',
      description: firstError ? `${firstError.path}: ${firstError.message}` : 'Please review configuration values.',
      variant: 'destructive',
    });
  };

  const handleSaveConfig = form.handleSubmit(async (values) => {
    try {
      await updateConfigMutation.mutateAsync({ id: environmentId, configYaml: values.configYaml });
      toast({ title: 'Configuration saved', description: 'Environment configuration has been updated.' });
    } catch {
      toast({ title: 'Save failed', description: 'Configuration did not pass validation.', variant: 'destructive' });
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!environment) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No environment found. Deploy first to use Dev Mode.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{environment.name}</h2>
          <Badge variant="secondary">{environment.serviceType}</Badge>
          <span className="text-sm text-muted-foreground">Branch: {environment.gitBranch}</span>
        </div>
      </div>

      <Tabs defaultValue="config" className="flex-1">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-6 h-10">
          <TabsTrigger value="config" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none">
            Config
          </TabsTrigger>
          <TabsTrigger value="deployments" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none">
            Deployments
          </TabsTrigger>
          <TabsTrigger value="metrics" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none">
            Metrics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="p-6 space-y-6 mt-0">
          <Card>
            <CardHeader>
              <CardTitle>liftoff.yml</CardTitle>
              <CardDescription>Validate and save environment deployment configuration.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void handleSaveConfig(event)} className="space-y-3">
                <textarea
                  className={cn(
                    'min-h-[320px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  )}
                  {...form.register('configYaml')}
                />
                {form.formState.errors.configYaml?.message && (
                  <p className="text-xs text-destructive">{form.formState.errors.configYaml.message}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void handleValidateConfig()} disabled={validateConfigMutation.isPending}>
                    {validateConfigMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Validate'}
                  </Button>
                  <Button type="submit" disabled={updateConfigMutation.isPending}>
                    {updateConfigMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Save config'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deployments" className="p-6 space-y-6 mt-0">
          <Card>
            <CardHeader>
              <CardTitle>Deployments</CardTitle>
              <CardDescription>Recent deployment history for this environment.</CardDescription>
            </CardHeader>
            <CardContent>
              {environment.deployments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No deployments yet.</p>
              ) : (
                <div className="space-y-2">
                  {environment.deployments.map((deployment) => (
                    <div key={deployment.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant={deployment.status === 'SUCCESS' ? 'secondary' : 'destructive'} className="text-xs">
                          {deployment.status}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(deployment.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrics" className="p-6 mt-0">
          <Card>
            <CardHeader>
              <CardTitle>Metrics</CardTitle>
              <CardDescription>Live resource usage for this environment.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="metrics">
                <DrawerMetricsTab environmentId={environmentId} />
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
