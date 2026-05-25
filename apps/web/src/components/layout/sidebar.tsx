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
    <aside className="flex h-full w-[64px] shrink-0 flex-col items-center border-r border-border/70 bg-background/80 py-4">
      <Link href="/dashboard" className="mb-6 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-foreground text-background shadow-[0_0_24px_hsl(var(--primary)/0.25)]">
        <Rocket className="h-4 w-4" />
        <span className="sr-only">Liftoff</span>
      </Link>

      <nav className="flex flex-col gap-2">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors',
                isActive
                  ? 'bg-secondary text-foreground shadow-inner'
                  : 'hover:bg-secondary/70 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="sr-only">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          title="Sign out"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => void handleSignOut()}
        >
          <LogOut className="h-4 w-4" />
          <span className="sr-only">Sign out</span>
        </Button>

        <div
          title={user?.name || user?.githubUsername || 'User'}
          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary text-xs font-semibold"
        >
          {user?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (user?.name || user?.githubUsername || 'U').slice(0, 1).toUpperCase()
          )}
        </div>
      </div>
    </aside>
  );
}
