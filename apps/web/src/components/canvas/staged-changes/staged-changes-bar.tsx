'use client';

import { Rocket, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStagedChangesStore } from './staged-changes-store';

interface StagedChangesBarProps {
  onDeploy: () => void;
  isDeploying?: boolean;
}

export function StagedChangesBar({ onDeploy, isDeploying }: StagedChangesBarProps) {
  const { changes, clearAll } = useStagedChangesStore();

  if (changes.length === 0) return null;

  const labels = changes.map((c) => c.label).join(', ');

  return (
    <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-xl">
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <span className="text-sm">
            <span className="font-semibold">{changes.length}</span>{' '}
            {changes.length === 1 ? 'Staged Change' : 'Staged Changes'}
          </span>
        </div>

        <div className="h-4 w-px bg-border" />

        <span className="max-w-[300px] truncate text-xs text-muted-foreground">{labels}</span>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground">
            <Trash2 className="mr-1 h-3 w-3" />
            Discard
          </Button>
          <Button size="sm" onClick={onDeploy} disabled={isDeploying}>
            <Rocket className="mr-1 h-3 w-3" />
            Deploy
          </Button>
        </div>
      </div>
    </div>
  );
}
