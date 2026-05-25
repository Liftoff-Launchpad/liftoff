'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, Database, Zap } from 'lucide-react';
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
  postgres: { icon: Database, label: 'PostgreSQL', color: 'border-sky-500/50' },
  redis: { icon: Zap, label: 'Redis', color: 'border-red-500/50' },
  storage: { icon: Box, label: 'Spaces', color: 'border-orange-500/50' },
};

function DatabaseNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as DatabaseNodeData;
  const engine = d.databaseEngine ?? 'postgres';
  const cfg = ENGINE_CONFIG[engine] ?? ENGINE_CONFIG.postgres;
  const Icon = cfg.icon;
  const borderColor = d.isStaged ? 'border-amber-400' : cfg.color;

  return (
    <div
      className={cn(
        'relative w-64 rounded-lg border bg-card/95 shadow-[0_20px_60px_hsl(252_30%_2%/0.32)] transition-all duration-200',
        'hover:border-primary/50',
        borderColor,
        selected && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-background !bg-muted-foreground"
      />

      <div className="flex items-center justify-between px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">{d.label}</p>
            <p className="text-xs text-muted-foreground">{cfg.label}</p>
          </div>
        </div>
        {!d.isStaged && (
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        )}
      </div>

      <div className="px-4 py-3 space-y-2">
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
