'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface ConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  nodeLabel?: string;
  nodeId?: string;
  children: React.ReactNode;
}

export function ConfigDrawer({ open, onClose, nodeLabel, nodeId, children }: ConfigDrawerProps) {
  return (
    <div
      className={cn(
        'absolute right-0 top-12 z-20 h-[calc(100%-3rem)] w-[420px] overflow-hidden border-l border-border bg-card shadow-xl transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="font-semibold">{nodeLabel ?? 'Node Settings'}</h3>
          {nodeId && <p className="text-xs text-muted-foreground font-mono">{nodeId.slice(0, 12)}...</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="metrics" className="flex h-full flex-col">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="metrics" className="flex-1 rounded-none data-[state=active]:bg-accent/50">
            Metrics
          </TabsTrigger>
          <TabsTrigger value="variables" className="flex-1 rounded-none data-[state=active]:bg-accent/50">
            Variables
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-1 rounded-none data-[state=active]:bg-accent/50">
            Settings
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto">{children}</div>
      </Tabs>
    </div>
  );
}
