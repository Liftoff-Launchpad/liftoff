'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ExternalLink, GitBranch, Globe, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DeploymentStatusType } from '@liftoff/shared';

interface ServiceNodeData {
  label: string;
  environmentId: string;
  serviceName?: string;
  endpoint?: string;
  imageUri?: string;
  region?: string;
  instanceSize?: string;
  status?: DeploymentStatusType;
  lastDeployTime?: string;
  isStaged?: boolean;
  gitBranch?: string;
  commitSha?: string;
  repoName?: string;
}

const STATUS_CONFIG: Record<string, { border: string; dot: string; animate?: string; label: string }> = {
  PENDING: { border: 'border-muted', dot: 'bg-muted-foreground', label: 'Pending' },
  QUEUED: { border: 'border-blue-400', dot: 'bg-blue-400', animate: 'animate-pulse', label: 'Queued' },
  BUILDING: { border: 'border-blue-500', dot: 'bg-blue-500', animate: 'animate-pulse', label: 'Building' },
  PUSHING: { border: 'border-indigo-500', dot: 'bg-indigo-500', animate: 'animate-pulse', label: 'Pushing' },
  PROVISIONING: { border: 'border-purple-500', dot: 'bg-purple-500', animate: 'animate-pulse', label: 'Provisioning' },
  DEPLOYING: { border: 'border-violet-500', dot: 'bg-violet-500', animate: 'animate-pulse', label: 'Deploying' },
  SUCCESS: { border: 'border-emerald-500', dot: 'bg-emerald-500', label: 'Live' },
  FAILED: { border: 'border-red-500', dot: 'bg-red-500', label: 'Failed' },
  STAGED: { border: 'border-amber-400', dot: 'bg-amber-400', label: 'Staged' },
};

function formatTimeAgo(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function ServiceNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as ServiceNodeData;
  const statusKey = d.isStaged ? 'STAGED' : (d.status ?? 'PENDING');
  const cfg = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.PENDING!;

  return (
    <div
      className={cn(
        'relative w-80 rounded-lg border bg-card/95 shadow-[0_20px_60px_hsl(252_30%_2%/0.32)] transition-all duration-200',
        'hover:border-primary/50',
        d.isStaged ? 'border-amber-400/70' : 'border-border',
        selected && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-background !bg-muted-foreground"
      />

      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background">
            <Rocket className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{d.label}</p>
            <p className="text-xs text-muted-foreground">Web Service</p>
          </div>
        </div>
        <span className={cn('h-2.5 w-2.5 rounded-full', cfg.dot, cfg.animate)} />
      </div>

      <div className="border-t border-border px-4 py-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className={cn('h-2.5 w-2.5 rounded-full', cfg.dot, cfg.animate)} />
          <span>{cfg.label === 'Live' ? 'Service is online' : `Service is ${cfg.label.toLowerCase()}`}</span>
        </div>

        {d.repoName && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <span className="truncate">{d.repoName}</span>
            {d.commitSha && (
              <span className="font-mono text-[10px]">@{d.commitSha.slice(0, 7)}</span>
            )}
          </div>
        )}

        {d.imageUri && (
          <p className="text-[10px] text-muted-foreground truncate font-mono">
            {d.imageUri.split('/').pop()?.slice(0, 24) ?? ''}
          </p>
        )}
      </div>

      <div className="px-4 py-3 space-y-1.5 border-t border-border bg-background/30">
        {d.endpoint && (
          <a
            href={d.endpoint}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Globe className="h-3 w-3" />
            <span className="truncate">{d.endpoint.replace(/^https?:\/\//, '')}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
          </a>
        )}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{d.region ?? '—'}</span>
          {d.instanceSize && (
            <>
              <span className="text-border">·</span>
              <span>{d.instanceSize}</span>
            </>
          )}
          {d.lastDeployTime && (
            <>
              <span className="text-border">·</span>
              <span>{formatTimeAgo(d.lastDeployTime)}</span>
            </>
          )}
        </div>
      </div>

      {d.isStaged && (
        <div className="absolute -top-2 -right-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-black">
          STAGED
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-background"
      />
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeComponent);
