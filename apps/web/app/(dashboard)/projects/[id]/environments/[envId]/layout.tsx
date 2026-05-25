'use client';

import { Activity, Bell, FileText, Gauge, Layers3, MessageSquare, Rocket, Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

function resolveRouteParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

export default function EnvironmentLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const params = useParams();
  const pathname = usePathname();
  const projectId = resolveRouteParam(params.id);
  const environmentId = resolveRouteParam(params.envId);
  const baseUrl = `/projects/${projectId}/environments/${environmentId}`;

  const nav = [
    { label: 'Canvas', href: `/projects/${projectId}/canvas`, icon: Layers3 },
    { label: 'Metrics', href: `${baseUrl}/metrics`, icon: Gauge },
    { label: 'Logs', href: `${baseUrl}/logs`, icon: FileText },
    { label: 'Settings', href: `${baseUrl}/settings`, icon: Settings },
  ];

  return (
    <div className="absolute inset-0 overflow-hidden bg-background">
      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <Link href="/projects" className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background">
            <Rocket className="h-4 w-4" />
            <span className="sr-only">Projects</span>
          </Link>
          <div className="h-7 w-px bg-border" />
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/projects/${projectId}/canvas`} className="font-semibold">Project</Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">production</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Activity className="h-4 w-4" />
          <Bell className="h-4 w-4" />
          <div className="h-7 w-px bg-border" />
          <span className="inline-flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4" />
            Agent
          </span>
        </div>
      </header>

      <aside className="absolute bottom-0 left-0 top-16 z-10 flex w-16 flex-col items-center border-r border-border bg-background/84 py-4 backdrop-blur-xl">
        <nav className="flex flex-col gap-2">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-lg transition-colors',
                  active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="sr-only">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="absolute inset-0 left-16 top-16 overflow-auto p-4">{children}</main>
    </div>
  );
}
