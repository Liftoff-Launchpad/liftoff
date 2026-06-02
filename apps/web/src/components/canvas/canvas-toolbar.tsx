'use client';

import {
  Activity,
  Bell,
  ChevronDown,
  Circle,
  Code2,
  LayoutGrid,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Rocket,
  ScrollText,
  Settings,
} from 'lucide-react';
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
  onAddClick: () => void;
  activityOpen: boolean;
  onActivityToggle: () => void;
  /** Whether the env-wide Logs panel is currently open. */
  logsOpen: boolean;
  /** Toggle the env-wide Logs slide-out (streams all services interleaved). */
  onLogsToggle: () => void;
  /** Apply the graph — provision resources + redeploy services with bindings. */
  onDeploy: () => void;
  /** Whether an apply is currently in flight. */
  deploying: boolean;
  /** Disable Deploy when there's no environment to apply yet. */
  canDeploy: boolean;
}

function getProjectStatus(nodes: Array<{ data: { status?: DeploymentStatusType } }>): {
  label: string;
  variant: 'success' | 'warning' | 'destructive' | 'secondary';
} {
  if (nodes.length === 0) return { label: 'No services', variant: 'secondary' };
  if (nodes.some((n) => n.data.status === 'FAILED')) return { label: 'Failed', variant: 'destructive' };
  if (
    nodes.some((n) =>
      ['QUEUED', 'BUILDING', 'PUSHING', 'PROVISIONING', 'DEPLOYING'].includes(n.data.status ?? ''),
    )
  ) {
    return { label: 'Deploying', variant: 'warning' };
  }
  if (nodes.every((n) => n.data.status === 'SUCCESS')) return { label: 'Live', variant: 'success' };
  return { label: 'Pending', variant: 'secondary' };
}

export function CanvasToolbar({
  projectId,
  projectName,
  nodes,
  mode,
  onModeChange,
  onAddClick,
  activityOpen,
  onActivityToggle,
  logsOpen,
  onLogsToggle,
  onDeploy,
  deploying,
  canDeploy,
}: CanvasToolbarProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = getProjectStatus(nodes);

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-4">
        <Link href="/projects" className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background">
          <Rocket className="h-4 w-4" />
          <span className="sr-only">Projects</span>
        </Link>
        <div className="h-7 w-px bg-border" />
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link href={`/projects/${projectId}/canvas`} className="truncate font-semibold">
            {projectName}
          </Link>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">/</span>
          <button type="button" className="inline-flex items-center gap-1 font-medium">
            production
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <span
          className={cn(
            'hidden items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold uppercase sm:inline-flex',
            status.variant === 'success' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
            status.variant === 'warning' && 'border-amber-500/30 bg-amber-500/10 text-amber-300',
            status.variant === 'destructive' && 'border-red-500/30 bg-red-500/10 text-red-400',
            status.variant === 'secondary' && 'border-border bg-secondary/60 text-muted-foreground',
          )}
        >
          <Circle className="h-2 w-2 fill-current" />
          {status.label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center rounded-lg border border-border bg-secondary/60 p-1 md:flex">
          <button
            onClick={() => onModeChange('canvas')}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
              mode === 'canvas' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Canvas
          </button>
          <button
            onClick={() => onModeChange('dev')}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
              mode === 'dev' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Code2 className="h-3.5 w-3.5" />
            Dev
          </button>
        </div>
        <Button
          variant={logsOpen ? 'secondary' : 'ghost'}
          size="icon"
          title="Env-wide logs"
          onClick={onLogsToggle}
        >
          <ScrollText className="h-4 w-4" />
        </Button>
        <Button
          variant={activityOpen ? 'secondary' : 'ghost'}
          size="icon"
          title="Activity"
          onClick={onActivityToggle}
        >
          <Activity className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Notifications">
          <Bell className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-7 w-px bg-border" />
        <Button variant="ghost" className="hidden gap-2 sm:inline-flex">
          <MessageSquare className="h-4 w-4" />
          Agent
        </Button>
        <Button onClick={onAddClick} variant="secondary" className="gap-2">
          <Plus className="h-4 w-4" />
          Add
        </Button>
        <Button
          onClick={onDeploy}
          disabled={deploying || !canDeploy}
          className="gap-2"
          title="Provision resources and redeploy services with connection variables"
        >
          {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          {deploying ? 'Deploying…' : 'Deploy'}
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/projects/${projectId}/settings`}>
                <Settings className="mr-2 h-4 w-4" />
                Project settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Delete project</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
