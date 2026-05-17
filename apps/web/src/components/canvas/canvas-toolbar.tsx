'use client';

import { ChevronLeft, Circle, Code2, LayoutGrid, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { type DeploymentStatusType } from '@liftoff/shared';

type ViewMode = 'canvas' | 'dev';

interface CanvasToolbarProps {
  projectId: string;
  projectName: string;
  nodes: Array<{ data: { status?: DeploymentStatusType } }>;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

function getProjectStatus(nodes: Array<{ data: { status?: DeploymentStatusType } }>): {
  label: string;
  variant: 'success' | 'warning' | 'destructive' | 'secondary';
  icon: React.ReactNode;
} {
  if (nodes.length === 0) {
    return { label: 'No Services', variant: 'secondary', icon: null };
  }

  const hasFailed = nodes.some((n) => n.data.status === 'FAILED');
  if (hasFailed) {
    return { label: 'FAILED', variant: 'destructive', icon: <Circle className="h-2 w-2 fill-current" /> };
  }

  const hasActive = nodes.some(
    (n) =>
      n.data.status === 'QUEUED' ||
      n.data.status === 'BUILDING' ||
      n.data.status === 'PUSHING' ||
      n.data.status === 'PROVISIONING' ||
      n.data.status === 'DEPLOYING',
  );
  if (hasActive) {
    return { label: 'DEPLOYING', variant: 'warning', icon: <Circle className="h-2 w-2 fill-current animate-pulse" /> };
  }

  const allSuccess = nodes.every((n) => n.data.status === 'SUCCESS');
  if (allSuccess) {
    return { label: 'LIVE', variant: 'success', icon: <Circle className="h-2 w-2 fill-current" /> };
  }

  return { label: 'PENDING', variant: 'secondary', icon: <Circle className="h-2 w-2 fill-current" /> };
}

export function CanvasToolbar({ projectId, projectName, nodes, mode, onModeChange }: CanvasToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = getProjectStatus(nodes);

  return (
    <div className="absolute left-0 right-0 top-0 z-10 flex h-12 items-center justify-between border-b border-border bg-card/80 backdrop-blur-sm px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href="/projects">
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Projects</span>
          </Link>
        </Button>

        <div className="h-4 w-px bg-border" />

        <h1 className="text-sm font-semibold">{projectName}</h1>

        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
            status.variant === 'success' && 'bg-emerald-500/10 text-emerald-500',
            status.variant === 'warning' && 'bg-yellow-500/10 text-yellow-500',
            status.variant === 'destructive' && 'bg-red-500/10 text-red-500',
            status.variant === 'secondary' && 'bg-muted text-muted-foreground',
          )}
        >
          {status.icon}
          {status.label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border p-0.5">
          <button
            onClick={() => onModeChange('canvas')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              mode === 'canvas' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutGrid className="h-3 w-3" />
            Canvas
          </button>
          <button
            onClick={() => onModeChange('dev')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              mode === 'dev' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Code2 className="h-3 w-3" />
            Dev
          </button>
        </div>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/projects/${projectId}/settings`}>Project Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">
              Delete Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
