'use client';

import { Boxes, CheckCircle2, Cloud, FolderGit2, Layers, Plus, Rocket } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useProjects } from '@/hooks/queries/use-projects';
import { useDoAccounts } from '@/hooks/queries/use-do-accounts';

interface StatTileProps {
  icon: typeof Boxes;
  label: string;
  value: number | string;
  hint?: string;
  delayMs: number;
}

function StatTile({ icon: Icon, label, value, hint, delayMs }: StatTileProps): JSX.Element {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-border/60 bg-card/50 p-5 duration-500 fill-mode-both"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function DashboardPage(): JSX.Element {
  const { data, isLoading } = useProjects(1, 50);
  const { data: doAccounts } = useDoAccounts();

  if (isLoading) {
    return (
      <section className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </section>
    );
  }

  const projects = data?.data ?? [];
  const totalProjects = data?.total ?? projects.length;
  const totalEnvironments = projects.reduce((sum, project) => sum + project._count.environments, 0);
  const doAccountCount = doAccounts?.length ?? 0;
  const validatedCount = doAccounts?.filter((account) => account.validatedAt).length ?? 0;
  const hasProjects = projects.length > 0;
  const hasDoAccount = doAccountCount > 0;
  const recentProjects = projects.slice(0, 6);

  return (
    <section className="space-y-8 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Everything you&apos;ve launched, at a glance.</p>
        </div>
        <Button asChild>
          <Link href="/projects">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>

      {!hasDoAccount && (
        <Card className="animate-in fade-in border-amber-500/30 bg-amber-500/5 duration-500">
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={FolderGit2} label="Projects" value={totalProjects} delayMs={0} />
        <StatTile
          icon={Layers}
          label="Environments"
          value={totalEnvironments}
          hint="across all projects"
          delayMs={60}
        />
        <StatTile icon={Cloud} label="DO accounts" value={doAccountCount} delayMs={120} />
        <StatTile
          icon={CheckCircle2}
          label="Validated"
          value={`${validatedCount}/${doAccountCount}`}
          hint="tokens checked"
          delayMs={180}
        />
      </div>

      {!hasProjects ? (
        <div className="flex min-h-[36vh] items-center justify-center">
          <div className="animate-in fade-in zoom-in-95 text-center duration-500">
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
            {recentProjects.map((project, index) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card
                  className="group h-full animate-in fade-in slide-in-from-bottom-2 border-border/50 bg-card/50 transition-all duration-300 fill-mode-both hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card hover:shadow-[0_12px_40px_hsl(252_30%_2%/0.3)]"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-110">
                        <Rocket className="h-4 w-4" />
                      </div>
                      <CardTitle className="text-base">{project.name}</CardTitle>
                    </div>
                    <CardDescription className="line-clamp-2 text-xs">
                      {project.description || 'No description'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2 py-1">
                      <Boxes className="h-3 w-3" />
                      {project._count.environments} env
                      {project._count.environments === 1 ? '' : 's'}
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
