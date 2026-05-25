'use client';

import { Download, FileText, Pause, Search, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function EnvironmentLogsPage(): JSX.Element {
  return (
    <section className="liftoff-panel min-h-[calc(100vh-96px)] overflow-hidden rounded-lg">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Filter and search logs" className="h-10 bg-background/40 pl-9" />
        </div>
        <Button variant="outline" className="gap-2">
          <Timer className="h-4 w-4" />
          Last 15 min
        </Button>
        <Button variant="outline" size="icon" title="Pause">
          <Pause className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" title="Download">
          <Download className="h-4 w-4" />
        </Button>
      </div>

      <div className="h-9 border-b border-border px-4 text-xs text-muted-foreground">
        <div className="flex h-full items-center justify-between">
          <span>10:50 PM</span>
          <span>10:52 PM</span>
        </div>
      </div>

      <div className="flex min-h-[calc(100vh-190px)] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-lg border border-border bg-secondary/30 text-muted-foreground">
            <FileText className="h-10 w-10" />
          </div>
          <h1 className="text-lg font-semibold">No logs in this time range</h1>
          <p className="mt-2 text-sm text-muted-foreground">Logs will show up here as they are found.</p>
        </div>
      </div>
    </section>
  );
}
