'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { DoAccountOnboardingModal } from '@/components/onboarding/do-account-modal';
import { useAuthRehydration } from '@/hooks/use-auth-rehydration';
import { useAuthStore } from '@/store/auth.store';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const router = useRouter();
  useAuthRehydration();
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <main className="flex h-screen items-center justify-center bg-background">
        <Spinner className="h-8 w-8" />
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="relative flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
      <DoAccountOnboardingModal />
    </div>
  );
}
