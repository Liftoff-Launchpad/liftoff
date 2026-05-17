'use client';

import { Circle, Plus, Rocket } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useProjects } from '@/hooks/queries/use-projects';
import { useDoAccounts } from '@/hooks/queries/use-do-accounts';

export default function DashboardPage(): JSX.Element {
  const { data, isLoading } = useProjects(1, 6);
  const { data: doAccounts } = useDoAccounts();

  if (isLoading) {
    return (
      <section className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </section>
    );
  }

  const hasProjects = data && data.data.length > 0;
  const hasDoAccount = doAccounts && doAccounts.length > 0;

  return (
    <section className="space-y-8 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Overview of your deployments.</p>
        </div>
        <Button asChild>
          <Link href="/projects">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>

      {!hasDoAccount && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium">Connect DigitalOcean</p>
              <p className="text-xs text-muted-foreground">
                Add your DO API token to start deploying infrastructure.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings">Connect</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!hasProjects ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="text-center">
            <Rocket className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
            <h3 className="text-lg font-medium">Welcome to Liftoff</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Deploy your GitHub repos to DigitalOcean with one click.
            </p>
            <Button className="mt-4" asChild>
              <Link href="/projects">
                <Plus className="mr-2 h-4 w-4" />
                Create your first project
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">Recent projects</h3>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/projects">View all</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.data.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="group h-full border-border/50 bg-card/50 transition-all hover:border-primary/30 hover:bg-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Rocket className="h-4 w-4" />
                      </div>
                      <CardTitle className="text-base">{project.name}</CardTitle>
                    </div>
                    <CardDescription className="line-clamp-2 text-xs">
                      {project.description || 'No description'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
                      {project._count.environments} env{project._count.environments === 1 ? '' : 's'}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
