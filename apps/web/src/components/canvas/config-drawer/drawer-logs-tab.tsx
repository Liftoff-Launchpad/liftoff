'use client';

import { TabsContent } from '@/components/ui/tabs';
import { LiveAppLogs } from '@/components/logs/live-app-logs';

interface DrawerLogsTabProps {
  /** Environment id whose App Platform service we stream logs from. */
  environmentId: string;
}

/**
 * Drawer tab that streams the env's live runtime logs without leaving the canvas.
 * Wraps `LiveAppLogs` in the Radix `TabsContent` slot so it only mounts (and thus
 * only opens the WebSocket stream) when the user actually selects the Logs tab.
 */
export function DrawerLogsTab({ environmentId }: DrawerLogsTabProps) {
  return (
    <TabsContent value="logs" className="m-0 p-8">
      {environmentId ? (
        <LiveAppLogs environmentId={environmentId} />
      ) : (
        <p className="rounded-md border border-dashed border-border bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">
          This node isn&apos;t linked to an environment yet.
        </p>
      )}
    </TabsContent>
  );
}
