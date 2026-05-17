'use client';

import { FolderKanban, LayoutDashboard, LogOut, Rocket, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth.store';

const navigationItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar(): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const handleSignOut = async (): Promise<void> => {
    try {
      await apiClient.delete('/auth/logout');
    } finally {
      clearAuth();
      router.push('/login');
    }
  };

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-border/50 bg-card/30 p-4">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2">
        <div className="rounded-lg bg-primary p-1.5 text-primary-foreground">
          <Rocket className="h-4 w-4" />
        </div>
        <span className="text-base font-semibold tracking-tight">Liftoff</span>
      </Link>

      <nav className="space-y-0.5">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3 border-t border-border/50 pt-4">
        <div className="space-y-0.5 px-1">
          <p className="truncate text-sm font-medium">
            {user?.name || user?.githubUsername || 'User'}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={() => void handleSignOut()}
        >
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
