'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavTab {
  label: string;
  href: string;
  testId?: string;
}

function resolveRouteParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) {
    return param[0] ?? '';
  }

  return param ?? '';
}

/**
 * Environment layout with persistent tab navigation.
 */
export default function EnvironmentLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const params = useParams();
  const pathname = usePathname();

  const projectId = resolveRouteParam(params.id);
  const environmentId = resolveRouteParam(params.envId);

  const baseUrl = `/projects/${projectId}/environments/${environmentId}`;

  const tabs: NavTab[] = [
    { label: 'Overview', href: baseUrl, testId: 'tab-overview' },
    { label: 'History', href: `${baseUrl}/history`, testId: 'tab-history' },
    { label: 'Logs', href: `${baseUrl}/logs`, testId: 'tab-logs' },
    { label: 'Metrics', href: `${baseUrl}/metrics`, testId: 'tab-metrics' },
    { label: 'Settings', href: `${baseUrl}/settings`, testId: 'tab-settings' },
  ];

  const isTabActive = (tabHref: string): boolean => {
    if (tabHref === baseUrl) {
      // Deployments tab is active when pathname is exactly the base or ends with [envId]
      return pathname === baseUrl || pathname.endsWith(`/environments/${environmentId}`);
    }
    return pathname === tabHref || pathname.startsWith(tabHref);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="border-b border-border">
        <nav className="flex gap-1">
          {tabs.map((tab) => {
            const active = isTabActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                data-testid={tab.testId}
                className={cn(
                  'px-4 py-2 text-sm font-medium transition-all duration-200 border-b-2 -mb-px',
                  active
                    ? 'border-blue-500 text-blue-600 font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div>{children}</div>
    </div>
  );
}
