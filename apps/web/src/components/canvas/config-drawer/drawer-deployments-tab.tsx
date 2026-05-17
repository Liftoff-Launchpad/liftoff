'use client';

import { Calendar, CheckCircle, Clock, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useDeployments, type DeploymentRecord } from '@/hooks/queries/use-deployments';
import { getSocket } from '@/lib/ws-client';
import { WsEvents, type WsDeploymentStatusPayload, type WsDeploymentLogPayload } from '@liftoff/shared';
import { useAuthStore } from '@/store/auth.store';
import type { DeploymentLogRecord } from '@/hooks/queries/use-deployments';

interface DrawerDeploymentsTabProps {
  environmentId: string;
}

function formatDuration(start?: string | Date, end?: string | Date): string {
  if (!start) return '—';
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.floor((endTime - startTime) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  SUCCESS: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
  FAILED: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  QUEUED: <Clock className="h-3.5 w-3.5 text-blue-400" />,
  BUILDING: <Clock className="h-3.5 w-3.5 animate-spin text-blue-500" />,
  DEPLOYING: <Clock className="h-3.5 w-3.5 animate-pulse text-violet-500" />,
};

export function DrawerDeploymentsTab({ environmentId }: DrawerDeploymentsTabProps) {
  const { data: deployments, isLoading } = useDeployments(environmentId, 1, 5);
  const [logs, setLogs] = useState<DeploymentLogRecord[]>([]);
  const [activeDeploymentId, setActiveDeploymentId] = useState<string | null>(null);

  const activeDeployment = deployments?.data?.find((d) => d.id === activeDeploymentId) ?? deployments?.data?.[0];

  useEffect(() => {
    if (activeDeployment && !activeDeployment.completedAt) {
      setActiveDeploymentId(activeDeployment.id);
    }
  }, [activeDeployment]);

  useEffect(() => {
    if (!activeDeploymentId) return;
    const accessToken = useAuthStore.getState().accessToken;
    if (!accessToken) return;

    const socket = getSocket(accessToken);
    socket.connect();
    socket.emit(WsEvents.JOIN_DEPLOYMENT, { deploymentId: activeDeploymentId });

    const handleStatus = (payload: WsDeploymentStatusPayload) => {
      if (payload.deploymentId === activeDeploymentId) {
        console.log('Deployment status update:', payload.status);
      }
    };

    const handleLog = (payload: WsDeploymentLogPayload) => {
      if (payload.deploymentId === activeDeploymentId) {
        setLogs((prev) => [...prev, {
          id: Date.now().toString(),
          deploymentId: activeDeploymentId,
          level: payload.level.toUpperCase() as DeploymentLogRecord['level'],
          message: payload.line,
          source: payload.source,
          timestamp: payload.timestamp,
        }]);
      }
    };

    socket.on(WsEvents.DEPLOYMENT_STATUS, handleStatus);
    socket.on(WsEvents.DEPLOYMENT_LOG, handleLog);

    return () => {
      socket.off(WsEvents.DEPLOYMENT_STATUS, handleStatus);
      socket.off(WsEvents.DEPLOYMENT_LOG, handleLog);
      socket.emit(WsEvents.LEAVE_DEPLOYMENT, { deploymentId: activeDeploymentId });
    };
  }, [activeDeploymentId]);

  if (isLoading) {
    return (
      <TabsContent value="deployments" className="flex h-full flex-col p-4">
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-6 w-6" />
        </div>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="deployments" className="flex h-full flex-col p-0">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {deployments?.data?.map((deployment) => (
            <div
              key={deployment.id}
              className={cn(
                'flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors',
                deployment.id === activeDeploymentId ? 'border-blue-500 bg-accent/30' : 'border-border',
              )}
            >
              <div className="flex items-center gap-2">
                {STATUS_ICONS[deployment.status] ?? <Clock className="h-3.5 w-3.5" />}
                <span className="font-mono text-xs">{deployment.commitSha?.slice(0, 7) ?? '—'}</span>
                <span className="text-xs text-muted-foreground">{deployment.branch ?? 'main'}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>{formatRelativeTime(deployment.createdAt)}</span>
                <span>{formatDuration(deployment.startedAt ?? undefined, deployment.completedAt ?? undefined)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {activeDeployment && !activeDeployment.completedAt && logs.length > 0 && (
        <div className="h-64 border-t border-border bg-black p-3 font-mono text-xs text-green-400">
          <pre className="overflow-y-auto whitespace-pre-wrap">{logs.map((log) => log.message).join('')}</pre>
        </div>
      )}
    </TabsContent>
  );
}
