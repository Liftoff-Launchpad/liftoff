'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Rocket } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, router]);

  if (isAuthenticated) {
    return <main className="min-h-screen bg-background" />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl bg-primary p-3 text-primary-foreground">
            <Rocket className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Liftoff</h1>
          <p className="text-sm text-muted-foreground">
            Deploy to DigitalOcean from a git push.
          </p>
        </div>

        <a
          href={`${apiUrl}/api/auth/github`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current">
            <path d="M8 0C3.58 0 0 3.69 0 8.24c0 3.64 2.29 6.72 5.47 7.81.4.08.55-.18.55-.39 0-.2-.01-.73-.01-1.43-2.22.5-2.69-1.1-2.69-1.1-.36-.95-.88-1.2-.88-1.2-.72-.51.05-.5.05-.5.8.06 1.22.85 1.22.85.71 1.24 1.87.89 2.33.68.07-.53.28-.89.5-1.09-1.77-.21-3.64-.91-3.64-4.05 0-.9.31-1.64.82-2.22-.08-.21-.36-1.06.08-2.2 0 0 .67-.22 2.2.85a7.41 7.41 0 0 1 4 0c1.53-1.07 2.2-.85 2.2-.85.44 1.14.16 1.99.08 2.2.51.58.82 1.32.82 2.22 0 3.15-1.87 3.84-3.65 4.05.29.25.54.74.54 1.5 0 1.09-.01 1.97-.01 2.24 0 .21.14.47.55.39A8.27 8.27 0 0 0 16 8.24C16 3.69 12.42 0 8 0Z" />
          </svg>
          Sign in with GitHub
        </a>

        <p className="text-xs text-muted-foreground">
          Your infrastructure, your DigitalOcean account.
        </p>
      </div>
    </main>
  );
}
