'use client';

import { BarChart3, Clock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function EnvironmentMetricsPage(): JSX.Element {
  return (
    <section className="liftoff-panel flex min-h-[calc(100vh-96px)] flex-col rounded-lg p-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" className="gap-2">
          <Clock className="h-4 w-4" />
          Last 1 hour
        </Button>
        <Button variant="outline" className="gap-2">
          <Plus className="h-4 w-4" />
          Add block
        </Button>
      </div>

      <div className="mt-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-background/20">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 grid h-28 w-28 grid-cols-2 gap-2 text-muted-foreground">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="rounded-md border border-border bg-secondary/40 p-2">
                <div className="mb-4 h-2 w-12 rounded bg-muted" />
                <div className="flex h-10 items-end gap-1">
                  {Array.from({ length: 10 }).map((_, index) => (
                    <span
                      key={index}
                      className="w-1 rounded bg-muted-foreground/30"
                      style={{ height: `${10 + ((index + item) % 5) * 7}px` }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <h1 className="text-xl font-semibold">Observe this environment</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Monitor project usage, resource metrics, and custom log dashboards once metrics endpoints are wired.
          </p>
          <div className="mt-8 grid gap-2">
            <Button variant="outline">Add new item</Button>
            <Button>
              <BarChart3 className="mr-2 h-4 w-4" />
              Start with a simple dashboard
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
