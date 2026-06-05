'use client';

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import { useDeployments, type DeploymentRecord } from '@/hooks/queries/use-deployments';

interface CanvasActivityProps {
  environmentId: string;
}

const IN_FLIGHT = new Set(['QUEUED', 'BUILDING', 'PUSHING', 'PROVISIONING', 'DEPLOYING', 'PENDING']);

function statusIcon(status: DeploymentRecord['status']): JSX.Element {
  if (status === 'SUCCESS') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === 'FAILED') return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === 'CANCELLED' || status === 'ROLLED_BACK')
    return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  if (IN_FLIGHT.has(status)) return <Loader2 className="h-4 w-4 animate-spin text-amber-300" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Recent deployment activity for the active environment — replaces the old
 * hardcoded "Canvas ready" placeholder with a real timeline.
 */
export function CanvasActivity({ environmentId }: CanvasActivityProps): JSX.Element {
  const { data, isLoading } = useDeployments(environmentId, 1, 15);
  const deployments = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="mt-8 flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (deployments.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
        <p className="text-sm font-medium">No activity yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Deploys show up here as they happen — push to your repo or hit Deploy.
        </p>
      </div>
    );
  }

  return (
    <ol className="mt-6 space-y-1">
      {deployments.map((deployment, index) => (
        <li
          key={deployment.id}
          className="flex animate-in fade-in slide-in-from-bottom-1 items-start gap-3 rounded-lg px-3 py-2.5 transition-colors duration-300 fill-mode-both hover:bg-secondary/50"
          style={{ animationDelay: `${index * 30}ms` }}
        >
          <span className="mt-0.5 shrink-0">{statusIcon(deployment.status)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">
                {deployment.commitMessage || deployment.commitSha?.slice(0, 7) || deployment.status}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {relativeTime(deployment.createdAt)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono uppercase">{deployment.status}</span>
              {deployment.commitSha && <span>· {deployment.commitSha.slice(0, 7)}</span>}
              {deployment.buildRunUrl && (
                <a
                  href={deployment.buildRunUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  build log
                </a>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
