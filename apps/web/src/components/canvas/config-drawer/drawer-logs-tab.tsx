'use client';

import { TabsContent } from '@/components/ui/tabs';
import { LiveAppLogs } from '@/components/logs/live-app-logs';

interface DrawerLogsTabProps {
  /** Environment id whose App Platform service we stream logs from. */
  environmentId: string;
  /**
   * Optional. When provided, scopes the stream to this service's App Platform
   * component (per-service logs). When omitted, shows env-wide logs.
   */
  serviceName?: string;
}

/**
 * Drawer tab that streams the selected service's live runtime logs without
 * leaving the canvas. Wraps `LiveAppLogs` in the Radix `TabsContent` slot so it
 * only mounts (and thus only opens the WebSocket stream) when the user actually
 * selects the Logs tab.
 *
 * Passes `serviceName` so the backend asks DO for only this component's lines —
 * the env-wide global logs panel (see CanvasToolbar) deliberately omits it.
 */
export function DrawerLogsTab({ environmentId, serviceName }: DrawerLogsTabProps) {
  return (
    <TabsContent value="logs" className="m-0 p-8">
      {environmentId ? (
        <LiveAppLogs environmentId={environmentId} serviceName={serviceName} />
      ) : (
        <p className="rounded-md border border-dashed border-border bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">
          This node isn&apos;t linked to an environment yet.
        </p>
      )}
    </TabsContent>
  );
}
