'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Radio, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { LogViewer, type DeploymentLogViewerEntry } from '@/components/deployments/log-viewer';
import { apiClient } from '@/lib/api-client';
import { getSocket } from '@/lib/ws-client';
import { useAuthStore } from '@/store/auth.store';

type LogType = 'RUN' | 'BUILD' | 'DEPLOY' | 'RUN_RESTARTED';

interface ServerLogLine {
  line: string;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  source: string;
  /** Identifies which stream a line belongs to so multiple viewers don't cross-render. */
  streamId?: string;
}

interface HttpLogEntry {
  line: string;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  source: string;
}

interface LiveAppLogsProps {
  environmentId: string;
  /**
   * Optional. Scopes the feed to a single App Platform component (one
   * `services[]` entry) via DO's `/v2/apps/:id/components/:name/logs` endpoint.
   * Omit for env-wide logs (all services interleaved).
   */
  serviceName?: string;
  /** Optional initial log type. Defaults to RUN (app's stdout/stderr). */
  defaultLogType?: LogType;
  /** Max lines to retain in memory. Older lines drop off the top when exceeded. */
  bufferLimit?: number;
  /** Optional height override for the LogViewer panel. */
  className?: string;
}

const DEFAULT_BUFFER_LIMIT = 5000;

/**
 * Live runtime log streamer.
 *
 * On mount: HTTP-backfills the last 200 log lines from `/environments/:eid/logs`,
 * then opens the `/deployments` socket and emits `start:log-stream` so the
 * EventsGateway pumps fresh lines as DO returns them (5s poll interval server-side).
 *
 * Pause stops accumulating new lines in the UI; the server keeps streaming so
 * you don't have a fresh cold-start when you resume.
 */
export function LiveAppLogs({
  environmentId,
  serviceName,
  defaultLogType = 'RUN',
  bufferLimit = DEFAULT_BUFFER_LIMIT,
  className,
}: LiveAppLogsProps): JSX.Element {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [logs, setLogs] = useState<DeploymentLogViewerEntry[]>([]);
  const [logType, setLogType] = useState<LogType>(defaultLogType);
  const [filter, setFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);

  const pausedRef = useRef(paused);
  const counterRef = useRef(0);
  const bufferLimitRef = useRef(bufferLimit);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    bufferLimitRef.current = bufferLimit;
  }, [bufferLimit]);

  // ─────────────────────────── initial backfill ───────────────────────────
  // HTTP-fetch the last N lines whenever envId, logType, or serviceName changes.
  // Resets the buffer so switching scope (e.g. env → "api" service) shows only
  // the new feed instead of mixing.
  useEffect(() => {
    let cancelled = false;
    setLogs([]);
    counterRef.current = 0;
    setSeedError(null);
    setSeedLoading(true);

    apiClient
      .get<HttpLogEntry[]>(`/environments/${environmentId}/logs`, {
        params: {
          type: logType,
          limit: 200,
          ...(serviceName ? { service: serviceName } : {}),
        },
      })
      .then((response) => {
        if (cancelled) return;
        const seeded = response.data.map((entry, index) => ({
          id: `seed-${index}-${entry.timestamp}`,
          line: entry.line,
          timestamp: entry.timestamp,
          level: entry.level,
          source: entry.source,
        }));
        counterRef.current = seeded.length;
        setLogs(seeded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error && typeof error === 'object' && 'response' in error
            ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
            : null;
        setSeedError(message ?? "Couldn't load log backfill. Live stream may still work.");
      })
      .finally(() => {
        if (!cancelled) setSeedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [environmentId, logType, serviceName]);

  // ─────────────────────────── live stream ───────────────────────────
  // Listen for `log-line` events on the singleton /deployments socket. We
  // unconditionally emit start:log-stream — the server is idempotent (a no-op
  // if already streaming this env).
  useEffect(() => {
    if (!accessToken || !environmentId) return;

    const socket = getSocket(accessToken);
    if (!socket.connected) socket.connect();

    // Unique id for THIS stream. The shared singleton socket is used by every
    // mounted viewer, so we tag our subscription and only accept our own lines —
    // otherwise two viewers (drawer + env-wide panel) each render every line.
    const streamId = `${environmentId}:${serviceName ?? 'env'}:${Math.random().toString(36).slice(2)}`;

    const handleLogLine = (payload: ServerLogLine): void => {
      if (pausedRef.current) return;
      // Ignore lines belonging to a different viewer's stream.
      if (payload.streamId && payload.streamId !== streamId) return;
      counterRef.current += 1;
      const entry: DeploymentLogViewerEntry = {
        id: `live-${payload.timestamp}-${counterRef.current}`,
        line: payload.line,
        timestamp: payload.timestamp,
        level: payload.level,
        source: payload.source,
      };
      setLogs((previous) => {
        const next = [...previous, entry];
        // Trim the front when we exceed the buffer cap so memory doesn't grow forever.
        const limit = bufferLimitRef.current;
        if (next.length > limit) {
          return next.slice(next.length - limit);
        }
        return next;
      });
    };

    const handleConnect = () => setStreamConnected(true);
    const handleDisconnect = () => setStreamConnected(false);

    socket.on('log-line', handleLogLine);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    setStreamConnected(socket.connected);

    // Kick off the server-side stream (scoped to this streamId). When serviceName
    // is set the server scopes to that App Platform component; otherwise env-wide.
    socket.emit('start:log-stream', {
      environmentId,
      streamId,
      ...(serviceName ? { serviceName } : {}),
    });

    return () => {
      // Tell the server to stop this stream's DO-polling generator, then detach.
      socket.emit('stop:log-stream', { streamId });
      socket.off('log-line', handleLogLine);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [accessToken, environmentId, serviceName]);

  const visibleLogs = useMemo(() => {
    if (!filter.trim()) return logs;
    const needle = filter.toLowerCase();
    return logs.filter((entry) => entry.line.toLowerCase().includes(needle));
  }, [logs, filter]);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter log lines..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-9 bg-background/40 pl-9 font-mono text-sm"
          />
        </div>

        <Select value={logType} onValueChange={(value) => setLogType(value as LogType)}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="RUN">Runtime</SelectItem>
            <SelectItem value="RUN_RESTARTED">Restart</SelectItem>
            <SelectItem value="BUILD">Build</SelectItem>
            <SelectItem value="DEPLOY">Deploy</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setPaused((value) => !value)}
          className="gap-1.5"
          title={paused ? 'Resume streaming' : 'Pause streaming'}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? 'Resume' : 'Pause'}
        </Button>

        <StreamStatus
          connected={streamConnected}
          paused={paused}
          loading={seedLoading}
          totalShown={visibleLogs.length}
          totalReceived={logs.length}
        />
      </div>

      {seedError && (
        <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {seedError}
        </p>
      )}

      {logs.length === 0 && !seedLoading ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-background/40 text-center">
          <Radio className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Waiting for log lines…</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Either this service hasn&apos;t emitted any {logType.toLowerCase()} logs yet, or
            the App Platform deployment isn&apos;t live. New lines stream in automatically.
          </p>
        </div>
      ) : (
        <LogViewer logs={visibleLogs} />
      )}
    </div>
  );
}

function StreamStatus({
  connected,
  paused,
  loading,
  totalShown,
  totalReceived,
}: {
  connected: boolean;
  paused: boolean;
  loading: boolean;
  totalShown: number;
  totalReceived: number;
}): JSX.Element {
  const label = paused
    ? 'paused'
    : !connected
      ? 'connecting'
      : loading
        ? 'loading'
        : 'live';

  const dotClass = paused
    ? 'bg-amber-400'
    : !connected
      ? 'bg-muted-foreground/50'
      : 'bg-emerald-500 animate-pulse';

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/30 px-3 py-1.5 text-xs">
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      <span className="font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {loading ? (
        <Spinner className="h-3 w-3" />
      ) : (
        <span className="text-muted-foreground">
          {totalShown.toLocaleString()}
          {totalShown !== totalReceived && (
            <span className="opacity-60"> / {totalReceived.toLocaleString()}</span>
          )}
        </span>
      )}
    </div>
  );
}
