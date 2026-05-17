'use client';

import { memo, useCallback } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { PipelineNodeType } from '@liftoff/shared';
import { cn } from '@/lib/utils';
import { getNodeDefinition } from '../node-definitions';

interface PipelineNodeData {
  [key: string]: unknown;
}

const TRIGGER_TYPES: PipelineNodeType[] = ['GitHubPushTrigger', 'ManualTrigger', 'ScheduleTrigger'];
const SERVICE_TYPES: PipelineNodeType[] = ['AppService'];

/**
 * Custom React Flow node component for all pipeline node types.
 * Renders with appropriate handles, colors, and a delete button.
 */
function PipelineNodeComponent({ id, data, type, selected }: NodeProps) {
  const nodeType = type as PipelineNodeType;
  const definition = getNodeDefinition(nodeType);
  const { deleteElements } = useReactFlow();

  const isTrigger = TRIGGER_TYPES.includes(nodeType);
  const isService = SERVICE_TYPES.includes(nodeType);

  const label = definition?.label ?? nodeType;
  const icon = definition?.icon ?? '⚙️';
  const color = definition?.color ?? '#6b7280';

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [deleteElements, id]);

  // Summary text based on node type
  const getSummary = (): string => {
    switch (nodeType) {
      case 'GitHubPushTrigger':
        return `Branch: ${(data as PipelineNodeData).branch ?? 'main'}`;
      case 'ScheduleTrigger':
        return `${(data as PipelineNodeData).cron ?? '0 2 * * *'}`;
      case 'DockerBuild':
        return `${(data as PipelineNodeData).dockerfilePath ?? 'Dockerfile'}`;
      case 'AppService':
        return `${(data as PipelineNodeData).name ?? 'my-app'}:${(data as PipelineNodeData).port ?? 3000}`;
      case 'PostgresDatabase':
        return `v${(data as PipelineNodeData).version ?? '15'}`;
      case 'SpacesBucket':
        return `${(data as PipelineNodeData).region ?? 'nyc3'}`;
      case 'CustomDomain':
        return `${(data as PipelineNodeData).domain || 'not set'}`;
      case 'EnvVars': {
        const vars = (data as PipelineNodeData).variables as Record<string, string> | undefined;
        const count = vars ? Object.keys(vars).length : 0;
        return `${count} variable${count !== 1 ? 's' : ''}`;
      }
      case 'Secret':
        return `${(data as PipelineNodeData).name || 'unnamed'}`;
      default:
        return '';
    }
  };

  return (
    <div
      className={cn(
        'relative rounded-xl border-2 bg-card shadow-lg transition-all duration-200 min-w-[180px]',
        'hover:shadow-xl hover:-translate-y-0.5',
        selected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-background' : '',
      )}
      style={{ borderColor: color }}
    >
      {/* Input handle — hidden for trigger nodes */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !border-2 !border-background !bg-muted-foreground"
        />
      )}

      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-[10px]"
        style={{ backgroundColor: `${color}18` }}
      >
        <span className="text-base" role="img" aria-label={label}>
          {icon}
        </span>
        <span className="text-xs font-semibold text-foreground flex-1 truncate">{label}</span>
        <button
          onClick={handleDelete}
          className={cn(
            'text-muted-foreground hover:text-destructive transition-opacity text-xs px-1',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          title="Remove node"
        >
          ✕
        </button>
      </div>

      {/* Body / summary */}
      <div className="px-3 py-2">
        <p className="text-[11px] text-muted-foreground truncate">{getSummary()}</p>
      </div>

      {/* Output handle — always present except pure config nodes (they attach to services) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-background"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}

export default memo(PipelineNodeComponent);
