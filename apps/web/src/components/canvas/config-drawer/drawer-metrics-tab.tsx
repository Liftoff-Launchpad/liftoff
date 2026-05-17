'use client';

import { useEffect, useState } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api-client';

interface MetricDatapoint {
  timestamp: number;
  value: number;
}

interface DrawerMetricsTabProps {
  environmentId: string;
}

async function fetchMetricSeries(environmentId: string, type: 'cpu' | 'memory' | 'bandwidth'): Promise<number[]> {
  try {
    const response = await apiClient.get<MetricDatapoint[]>(`/environments/${environmentId}/metrics/${type}`);
    if (Array.isArray(response.data)) {
      return response.data.map((d) => (typeof d === 'number' ? d : d.value ?? 0));
    }
    return [];
  } catch {
    return [];
  }
}

export function DrawerMetricsTab({ environmentId }: DrawerMetricsTabProps) {
  const [cpu, setCpu] = useState<number[]>([]);
  const [memory, setMemory] = useState<number[]>([]);
  const [network, setNetwork] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    const fetchAll = async () => {
      try {
        const [cpuData, memData, netData] = await Promise.all([
          fetchMetricSeries(environmentId, 'cpu'),
          fetchMetricSeries(environmentId, 'memory'),
          fetchMetricSeries(environmentId, 'bandwidth'),
        ]);
        if (mounted) {
          setCpu(cpuData.length > 0 ? cpuData : [0]);
          setMemory(memData.length > 0 ? memData : [0]);
          setNetwork(netData.length > 0 ? netData : [0]);
          setLoading(false);
        }
      } catch {
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    };

    void fetchAll();
    const interval = setInterval(() => { void fetchAll(); }, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [environmentId]);

  if (loading) {
    return (
      <TabsContent value="metrics" className="flex h-full items-center justify-center p-4">
        <Spinner className="h-6 w-6" />
      </TabsContent>
    );
  }

  if (error) {
    return (
      <TabsContent value="metrics" className="p-4">
        <p className="text-sm text-muted-foreground">Deploy first to see metrics.</p>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="metrics" className="flex h-full flex-col gap-6 p-4">
      <MetricChart label="CPU" data={cpu} max={100} unit="%" color="#8b5cf6" />
      <MetricChart label="Memory" data={memory} max={100} unit="%" color="#3b82f6" />
      <MetricChart label="Network" data={network} max={100} unit="MB/s" color="#10b981" />
    </TabsContent>
  );
}

function MetricChart({ label, data, max, unit, color }: { label: string; data: number[]; max: number; unit: string; color: string }) {
  const latestValue = data[data.length - 1] ?? 0;
  const safeData = data.length < 2 ? [0, ...data] : data;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground font-mono">
          {latestValue.toFixed(1)}{unit}
        </span>
      </div>
      <div className="h-16 w-full overflow-hidden rounded-lg bg-accent/30 p-1">
        <svg viewBox="0 0 100 50" className="h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`gradient-${label}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <polygon
            fill={`url(#gradient-${label})`}
            points={`0,50 ${safeData.map((v, i) => `${(i / (safeData.length - 1)) * 100},${50 - (v / max) * 50}`).join(' ')} 100,50`}
          />
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={safeData.map((v, i) => `${(i / (safeData.length - 1)) * 100},${50 - (v / max) * 50}`).join(' ')}
          />
        </svg>
      </div>
    </div>
  );
}
