'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';

interface DatabaseNodeData {
  label: string;
  environmentId: string;
  databaseEngine?: 'postgres' | 'redis';
  hostname?: string;
  port?: number;
  bucketName?: string;
  isStaged?: boolean;
  outputs?: Record<string, string>;
}

const ENGINE_CONFIG = {
  postgres: { icon: '🐘', label: 'PostgreSQL', color: 'border-blue-600/50' },
  redis: { icon: '⚡', label: 'Redis', color: 'border-red-500/50' },
  storage: { icon: '🪣', label: 'Spaces', color: 'border-orange-500/50' },
};

function DatabaseNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as DatabaseNodeData;
  const engine = d.databaseEngine ?? 'postgres';
  const cfg = ENGINE_CONFIG[engine] ?? ENGINE_CONFIG.postgres;
  const borderColor = d.isStaged ? 'border-amber-400' : cfg.color;

  return (
    <div
      className={cn(
        'relative w-56 rounded-xl border-2 bg-card shadow-lg transition-all duration-200',
        'hover:shadow-xl',
        borderColor,
        selected && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-background !bg-muted-foreground"
      />

      <div className="flex items-center justify-between px-3 py-2.5 rounded-t-[10px] border-b border-border bg-accent/30">
        <div className="flex items-center gap-2">
          <span className="text-sm">{cfg.icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {cfg.label}
          </span>
        </div>
        {!d.isStaged && (
          <span className="text-[10px] font-semibold uppercase text-emerald-500">Active</span>
        )}
      </div>

      <div className="px-3 py-3 space-y-2">
        <p className="text-sm font-semibold">{d.label}</p>

        {d.hostname && (
          <div className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Host</p>
            <p className="text-xs truncate font-mono">{d.hostname}</p>
          </div>
        )}
        {d.port && (
          <p className="text-xs text-muted-foreground">Port: {d.port}</p>
        )}
        {d.bucketName && (
          <div className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Bucket</p>
            <p className="text-xs truncate font-mono">{d.bucketName}</p>
          </div>
        )}
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

export const DatabaseNode = memo(DatabaseNodeComponent);
