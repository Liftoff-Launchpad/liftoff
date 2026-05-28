'use client';

import { useParams } from 'next/navigation';
import { LiveAppLogs } from '@/components/logs/live-app-logs';

function resolveRouteParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

/**
 * Live app log viewer for an environment. Hosted at the URL the env layout's
 * sidebar already links to (`Logs` button).
 */
export default function EnvironmentLogsPage(): JSX.Element {
  const params = useParams();
  const environmentId = resolveRouteParam(params.envId);

  return (
    <section className="liftoff-panel min-h-[calc(100vh-96px)] overflow-hidden rounded-lg p-4">
      <header className="mb-3">
        <h1 className="text-lg font-semibold">App logs</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Live runtime output from your App Platform service. Switch type to inspect build / deploy
          history. Backfills the last 200 lines, then streams new lines via WebSocket.
        </p>
      </header>
      <LiveAppLogs environmentId={environmentId} />
    </section>
  );
}
