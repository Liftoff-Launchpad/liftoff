'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Github } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RepositoryNodeData {
  label: string;
  repoFullName?: string;
  repoBranch?: string;
  webhookStatus?: 'active' | 'missing';
  isPrimary?: boolean;
}

/**
 * Phase F: a connected GitHub repository on the canvas. Dashed edges run from it
 * to each service it builds (provenance). Informational + fixed-position — it has
 * only a source handle and doesn't open the service drawer.
 */
function RepositoryNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as RepositoryNodeData;
  const webhookOk = d.webhookStatus !== 'missing';

  return (
    <div
      className={cn(
        'relative w-56 rounded-lg border bg-card/95 shadow-[0_20px_60px_hsl(252_30%_2%/0.32)] transition-all duration-200',
        'border-border hover:border-primary/40',
        selected && 'ring-2 ring-primary/40 ring-offset-2 ring-offset-background',
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary">
          <Github className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{d.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {d.repoFullName ?? 'GitHub repository'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className="truncate">{d.repoBranch ?? 'main'}</span>
        <span className="text-border">·</span>
        <span
          className={cn(
            'inline-flex items-center gap-1',
            webhookOk ? 'text-emerald-400' : 'text-red-400',
          )}
          title={webhookOk ? 'Webhook active' : 'Webhook missing'}
        >
          <span
            className={cn('h-1.5 w-1.5 rounded-full', webhookOk ? 'bg-emerald-400' : 'bg-red-400')}
          />
          {webhookOk ? 'hook' : 'no hook'}
        </span>
      </div>

      {d.isPrimary && (
        <div className="absolute -top-2 -right-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-foreground">
          PRIMARY
        </div>
      )}

      {/* Source-only: provenance flows repo → service. Not user-connectable. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!w-3 !h-3 !border-2 !border-background !bg-muted-foreground"
      />
    </div>
  );
}

export const RepositoryNode = memo(RepositoryNodeComponent);
