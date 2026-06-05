'use client';

import { Globe2, MapPin, Rocket, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CanvasActivity } from '../canvas-activity';

interface ConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  nodeLabel?: string;
  nodeId?: string;
  status?: string;
  repoName?: string;
  region?: string;
  replicas?: number;
  /** Environment id — drives the real Deployments tab list. */
  environmentId?: string;
  children: React.ReactNode;
}

export function ConfigDrawer({
  open,
  onClose,
  nodeLabel,
  nodeId,
  status = 'PENDING',
  repoName,
  region,
  replicas = 1,
  environmentId,
  children,
}: ConfigDrawerProps) {
  const displayName = nodeLabel ?? 'Node Settings';
  const hasActiveDeployment = status === 'SUCCESS';

  return (
    <div
      className={cn(
        'absolute bottom-0 right-0 top-16 z-20 w-[min(1120px,52vw)] min-w-[560px] overflow-hidden border-l border-border bg-card shadow-[0_24px_80px_hsl(252_30%_2%/0.48)] transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="border-b border-border px-10 pt-8">
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <Rocket className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-2xl font-semibold tracking-normal">{displayName}</h3>
              {nodeId && <p className="mt-1 font-mono text-xs text-muted-foreground">{nodeId.slice(0, 12)}...</p>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Tabs defaultValue="deployments" className="mt-7 flex h-[calc(100vh-10rem)] flex-col">
          <TabsList className="h-auto w-full justify-start gap-8 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger
              value="deployments"
              className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-base text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Deployments
            </TabsTrigger>
            <TabsTrigger
              value="variables"
              className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-base text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Variables
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-base text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Logs
            </TabsTrigger>
            <TabsTrigger
              value="metrics"
              className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-base text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Metrics
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-base text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Settings
            </TabsTrigger>
          </TabsList>

          <div className="-mx-10 flex-1 overflow-y-auto border-t border-border">
            <TabsContent value="deployments" className="m-0 p-10">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Globe2 className="h-4 w-4" />
                  <span>{hasActiveDeployment ? 'Public service' : 'Unexposed service'}</span>
                </div>
                <div className="flex items-center gap-5">
                  <span className="inline-flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {region || 'US East'}
                  </span>
                  <span>{replicas} Replica{replicas === 1 ? '' : 's'}</span>
                </div>
              </div>

              {environmentId ? (
                <CanvasActivity environmentId={environmentId} />
              ) : (
                <div className="mt-5 flex min-h-28 items-center justify-center rounded-lg border border-dashed border-border bg-background/35 px-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Deploy history will appear here once this environment is set up.
                  </p>
                </div>
              )}
            </TabsContent>

            {children}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
