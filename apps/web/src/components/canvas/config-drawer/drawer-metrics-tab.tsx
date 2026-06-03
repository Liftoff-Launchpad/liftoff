'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Spinner } from '@/components/ui/spinner';
import { TabsContent } from '@/components/ui/tabs';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface MetricDatapoint {
  timestamp: number;
  value: number;
}

interface DrawerMetricsTabProps {
  environmentId: string;
  /** When set, metrics are scoped to this service's App Platform component. */
  serviceName?: string;
}

type MetricType = 'cpu' | 'memory' | 'bandwidth' | 'restart-count';
type Range = '1h' | '6h' | '1d' | '7d' | '30d';

const RANGES: Range[] = ['1h', '6h', '1d', '7d', '30d'];
const METRIC_REFETCH_MS = 30_000;

/**
 * Per-service DO App Platform metrics with a working time-range picker and
 * recharts charts. Polls every 30s while the tab + browser tab are visible.
 */
export function DrawerMetricsTab({ environmentId, serviceName }: DrawerMetricsTabProps) {
  const isPageVisible = usePageVisible();
  const [range, setRange] = useState<Range>('1h');

  const cpuQuery = useMetricQuery(environmentId, 'cpu', serviceName, range, isPageVisible);
  const memoryQuery = useMetricQuery(environmentId, 'memory', serviceName, range, isPageVisible);
  const networkQuery = useMetricQuery(environmentId, 'bandwidth', serviceName, range, isPageVisible);
  const restartQuery = useMetricQuery(environmentId, 'restart-count', serviceName, range, isPageVisible);

  const isInitialLoading =
    (cpuQuery.isLoading || memoryQuery.isLoading || networkQuery.isLoading || restartQuery.isLoading) &&
    !cpuQuery.data &&
    !memoryQuery.data &&
    !networkQuery.data &&
    !restartQuery.data;

  const hasAnyData =
    (cpuQuery.data?.length ?? 0) +
      (memoryQuery.data?.length ?? 0) +
      (networkQuery.data?.length ?? 0) +
      (restartQuery.data?.length ?? 0) >
    0;

  if (isInitialLoading) {
    return (
      <TabsContent value="metrics" className="m-0 flex h-full items-center justify-center p-10">
        <Spinner className="h-6 w-6" />
      </TabsContent>
    );
  }

  return (
    <TabsContent value="metrics" className="m-0 p-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={cn(
                'border-r border-border px-4 py-2 text-sm transition-colors last:border-r-0',
                range === option
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {serviceName ? `${serviceName} · ` : ''}every {METRIC_REFETCH_MS / 1000}s ·{' '}
          {isPageVisible ? 'live' : 'paused (tab hidden)'}
        </p>
      </div>

      {!hasAnyData ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-background/40 text-center">
          <Activity className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No metrics yet</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            DigitalOcean takes a few minutes to populate CPU / memory / bandwidth after a service
            starts. If the env hasn&apos;t deployed yet, deploy first.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <MetricChart label="CPU" data={cpuQuery.data ?? []} max={100} unit="%" color="#8b5cf6" />
          <MetricChart
            label="Memory"
            data={memoryQuery.data ?? []}
            max={100}
            unit="%"
            color="#6f8cff"
          />
          <MetricChart
            label="Network"
            data={networkQuery.data ?? []}
            max={100}
            unit=" MB/s"
            color="#10b981"
          />
          <MetricChart
            label="Restarts"
            data={restartQuery.data ?? []}
            max="auto"
            unit=""
            color="#f59e0b"
          />
        </div>
      )}
    </TabsContent>
  );
}

function useMetricQuery(
  environmentId: string,
  type: MetricType,
  serviceName: string | undefined,
  range: Range,
  visible: boolean,
) {
  return useQuery<MetricDatapoint[]>({
    queryKey: ['metrics', environmentId, type, serviceName ?? 'env', range],
    enabled: Boolean(environmentId) && visible,
    queryFn: async () => {
      const response = await apiClient.get<MetricDatapoint[]>(
        `/environments/${environmentId}/metrics/${type}`,
        { params: { range, ...(serviceName ? { service: serviceName } : {}) } },
      );
      return Array.isArray(response.data) ? response.data : [];
    },
    refetchInterval: visible ? METRIC_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: METRIC_REFETCH_MS - 5_000,
    retry: 1,
  });
}

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
}: {
  label: string;
  data: MetricDatapoint[];
  /** Fixed upper bound for percentage metrics, or 'auto' for counts (restarts). */
  max: number | 'auto';
  unit: string;
  color: string;
}) {
  const chartData = data.map((point) => ({
    // DO returns unix seconds; render a short HH:MM label.
    time: new Date(point.timestamp * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
    value: Number(point.value.toFixed(2)),
  }));
  const latestValue = data[data.length - 1]?.value ?? 0;
  const hasData = chartData.length > 0;
  const gradientId = `metric-grad-${label}`;

  return (
    <div className="rounded-lg border border-border bg-background/25 p-5">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {hasData ? `${latestValue.toFixed(1)}${unit}` : '—'}
        </span>
      </div>
      <div className="mt-4 h-44 w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={[0, max]}
                allowDecimals={max !== 'auto'}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={34}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                formatter={(value: number) => [`${value}${unit}`, label]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            no data
          </div>
        )}
      </div>
    </div>
  );
}
