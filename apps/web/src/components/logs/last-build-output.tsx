'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogViewer, type DeploymentLogViewerEntry } from '@/components/deployments/log-viewer';
import { useLatestServiceDeployment } from '@/hooks/queries/use-deployments';

interface LastBuildOutputProps {
  environmentId: string;
  serviceName: string;
}

const TERMINAL_STATUSES = new Set([
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
]);

/**
 * Compact panel above the live runtime logs that surfaces the most recent
 * deployment for the selected service. When the deploy failed, it auto-expands
 * the captured build output so the user sees the actual error — no need to
 * leave for GitHub Actions. On success/in-flight it stays collapsed by default.
 *
 * Polls every 5s while the deploy is in-flight so the UI tracks progress; goes
 * idle once the deploy reaches a terminal state.
 */
export function LastBuildOutput({ environmentId, serviceName }: LastBuildOutputProps): JSX.Element | null {
  const [manuallyExpanded, setManuallyExpanded] = useState<boolean | null>(null);

  const { data, isLoading, error } = useLatestServiceDeployment(environmentId, serviceName, {
    refetchIntervalMs: 5000,
  });

  const result = data ?? null;
  const deployment = result?.deployment;
  const logs = result?.logs ?? [];

  const isFailure = deployment?.status === 'FAILED' || deployment?.status === 'CANCELLED';
  const isTerminal = deployment ? TERMINAL_STATUSES.has(deployment.status) : false;
  // Default-expand on failure; otherwise default-collapsed. User toggle overrides.
  const expanded = manuallyExpanded ?? isFailure;

  const viewerEntries = useMemo<DeploymentLogViewerEntry[]>(
    () =>
      logs.map((entry) => ({
        id: entry.id,
        line: entry.message,
        timestamp: entry.timestamp,
        level: entry.level,
        source: entry.source,
      })),
    [logs],
  );

  const buildLogCount = logs.filter((entry) => entry.source === 'build').length;

  if (isLoading && !deployment) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking latest deployment…
      </div>
    );
  }

  if (error) {
    return null; // Silent on error — live logs viewer below is the primary surface.
  }

  if (!deployment) {
    return null; // Service never deployed; nothing to surface.
  }

  return (
    <div
      className={`mb-3 rounded-md border ${
        isFailure
          ? 'border-red-500/40 bg-red-500/5'
          : deployment.status === 'SUCCESS'
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-border bg-background/40'
      }`}
    >
      <div className="flex items-start gap-3 px-3 py-2">
        <StatusIcon status={deployment.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium">
              Last deploy: <span className="font-mono">{deployment.status}</span>
            </span>
            {deployment.commitSha && (
              <span className="text-[11px] text-muted-foreground">
                {deployment.commitSha.slice(0, 7)}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">
              {new Date(deployment.createdAt).toLocaleString()}
            </span>
            {!isTerminal && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                in progress
              </span>
            )}
          </div>

          {deployment.errorMessage && isFailure && (
            <p className="mt-1 break-words text-xs text-red-300">{deployment.errorMessage}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {buildLogCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setManuallyExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="mr-1 h-3 w-3" />
                ) : (
                  <ChevronDown className="mr-1 h-3 w-3" />
                )}
                {expanded ? 'Hide' : 'Show'} build output ({buildLogCount.toLocaleString()} lines)
              </Button>
            )}
            {deployment.buildRunUrl && (
              <a
                href={deployment.buildRunUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
              >
                GitHub Actions run
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {expanded && viewerEntries.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <LogViewer logs={viewerEntries} />
        </div>
      )}

      {expanded && viewerEntries.length === 0 && (
        <div className="border-t border-border px-3 py-3 text-center text-[11px] text-muted-foreground">
          No build output captured for this deployment.
          {deployment.buildRunUrl ? ' View it on GitHub Actions for details.' : ''}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }): JSX.Element {
  if (status === 'SUCCESS') {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />;
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />;
  }
  return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-300" />;
}
