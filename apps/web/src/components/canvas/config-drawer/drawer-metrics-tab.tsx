'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { TabsContent } from '@/components/ui/tabs';
import { apiClient } from '@/lib/api-client';

interface MetricDatapoint {
  timestamp: number;
  value: number;
}

interface DrawerMetricsTabProps {
  environmentId: string;
}

type MetricType = 'cpu' | 'memory' | 'bandwidth';

const METRIC_REFETCH_MS = 30_000;

/**
 * Polls DO App Platform metrics every 30s while:
 *   - the drawer Metrics tab is the visible one (Radix unmounts inactive TabsContent
 *     so `useEffect`/`useQuery` only fire when it's selected)
 *   - the browser tab is visible (Page Visibility API gate)
 *
 * Backend now returns `[]` instead of 400 when the env has no Pulumi stack yet,
 * so polling against an un-deployed env quietly shows an empty chart instead of
 * spamming the console with "App Platform outputs are missing" warnings.
 */
export function DrawerMetricsTab({ environmentId }: DrawerMetricsTabProps) {
  const isPageVisible = usePageVisible();

  const cpuQuery = useMetricQuery(environmentId, 'cpu', isPageVisible);
  const memoryQuery = useMetricQuery(environmentId, 'memory', isPageVisible);
  const networkQuery = useMetricQuery(environmentId, 'bandwidth', isPageVisible);

  const isInitialLoading =
    (cpuQuery.isLoading || memoryQuery.isLoading || networkQuery.isLoading) &&
    !cpuQuery.data &&
    !memoryQuery.data &&
    !networkQuery.data;

  const hasAnyData =
    (cpuQuery.data?.length ?? 0) +
      (memoryQuery.data?.length ?? 0) +
      (networkQuery.data?.length ?? 0) >
    0;

  if (isInitialLoading) {
    return (
      <TabsContent value="metrics" className="m-0 flex h-full items-center justify-center p-10">
        <Spinner className="h-6 w-6" />
      </TabsContent>
    );
  }

  if (!hasAnyData) {
    return (
      <TabsContent value="metrics" className="m-0 p-10">
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-background/40 text-center">
          <Activity className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No metrics yet</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            DigitalOcean takes a few minutes to populate CPU / memory / bandwidth
            after a service starts. If this is a fresh deploy, refresh in a bit. If
            the env hasn&apos;t deployed yet, push a commit (or click Redeploy).
          </p>
        </div>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="metrics" className="m-0 p-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {['1h', '6h', '1d', '7d', '30d'].map((range) => (
            <button
              key={range}
              type="button"
              className="border-r border-border px-4 py-2 text-sm text-muted-foreground last:border-r-0 first:text-primary"
            >
              {range}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Refresh every {METRIC_REFETCH_MS / 1000}s · {isPageVisible ? 'live' : 'paused (tab hidden)'}
        </p>
      </div>
      <div className="space-y-5">
        <MetricChart
          label="CPU"
          data={cpuQuery.data ?? []}
          max={100}
          unit="%"
          color="#8b5cf6"
          ceiling="Max 1 vCPU"
        />
        <MetricChart
          label="Memory"
          data={memoryQuery.data ?? []}
          max={100}
          unit="%"
          color="#6f8cff"
          ceiling="Max 0.5 GB"
        />
        <MetricChart
          label="Network"
          data={networkQuery.data ?? []}
          max={100}
          unit="MB/s"
          color="#10b981"
          ceiling="Max 1 GB/s"
        />
      </div>
    </TabsContent>
  );
}

function useMetricQuery(environmentId: string, type: MetricType, visible: boolean) {
  return useQuery<MetricDatapoint[]>({
    queryKey: ['metrics', environmentId, type],
    enabled: Boolean(environmentId) && visible,
    queryFn: async () => {
      const response = await apiClient.get<MetricDatapoint[]>(
        `/environments/${environmentId}/metrics/${type}`,
      );
      return Array.isArray(response.data) ? response.data : [];
    },
    refetchInterval: visible ? METRIC_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: METRIC_REFETCH_MS - 5_000,
    // Backend now returns [] on un-provisioned envs so a normal 200 falls through
    // here. If we ever hit a real network error, swallow it and show empty rather
    // than letting it bubble into a toast/notification.
    retry: 1,
  });
}

/**
 * Tracks `document.visibilityState` so polling pauses when the user switches
 * tabs. Avoids burning DO API quota for envs the user isn't actively watching.
 */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return visible;
}

function MetricChart({
  label,
  data,
  max,
  unit,
  color,
  ceiling,
}: {
  label: string;
  data: MetricDatapoint[];
  max: number;
  unit: string;
  color: string;
  ceiling: string;
}) {
  const values = data.map((point) => point.value);
  const latestValue = values[values.length - 1] ?? 0;
  const safeData = values.length < 2 ? [0, ...values] : values;
  const hasData = values.length > 0;

  return (
    <div className="rounded-lg border border-border bg-background/25 p-5">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {ceiling} · {hasData ? `${latestValue.toFixed(1)}${unit}` : '—'}
        </span>
      </div>
      <div className="mt-5 h-48 w-full overflow-hidden rounded-lg bg-card/40 p-1">
        {hasData ? (
          <svg viewBox="0 0 100 50" className="h-full w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`gradient-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <polygon
              fill={`url(#gradient-${label})`}
              points={`0,50 ${safeData
                .map((v, i) => `${(i / (safeData.length - 1)) * 100},${50 - (v / max) * 50}`)
                .join(' ')} 100,50`}
            />
            <polyline
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={safeData
                .map((v, i) => `${(i / (safeData.length - 1)) * 100},${50 - (v / max) * 50}`)
                .join(' ')}
            />
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            no data
          </div>
        )}
      </div>
    </div>
  );
}
