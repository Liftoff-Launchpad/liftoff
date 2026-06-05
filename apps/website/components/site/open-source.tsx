import {
  Boxes,
  Container as ContainerIcon,
  Package,
  Github,
  Server,
  PanelsTopLeft,
  Database,
  ListChecks,
  Network,
  Radio,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Reveal } from '@/components/ui/reveal';
import { SectionHeading } from '@/components/ui/section-heading';
import { ButtonLink } from '@/components/ui/button';
import { cn, links } from '@/lib/utils';

interface StackTile {
  name: string;
  role: string;
  icon: LucideIcon;
  /** Icon accent tint, e.g. "text-violet". */
  accent: string;
}

const stack: StackTile[] = [
  {
    name: 'Pulumi',
    role: 'Infrastructure as code',
    icon: Boxes,
    accent: 'text-violet',
  },
  {
    name: 'Docker',
    role: 'Reproducible images',
    icon: ContainerIcon,
    accent: 'text-blue',
  },
  {
    name: 'Nixpacks',
    role: 'Zero-config builds',
    icon: Package,
    accent: 'text-cyan',
  },
  {
    name: 'GitHub Actions',
    role: 'CI build & push',
    icon: Github,
    accent: 'text-foreground',
  },
  {
    name: 'NestJS',
    role: 'API & orchestration',
    icon: Server,
    accent: 'text-violet',
  },
  {
    name: 'Next.js',
    role: 'Dashboard & canvas',
    icon: PanelsTopLeft,
    accent: 'text-foreground',
  },
  {
    name: 'PostgreSQL',
    role: 'Primary datastore',
    icon: Database,
    accent: 'text-blue',
  },
  {
    name: 'Redis + BullMQ',
    role: 'Queues & jobs',
    icon: ListChecks,
    accent: 'text-cyan',
  },
  {
    name: 'Prisma',
    role: 'Type-safe ORM',
    icon: Network,
    accent: 'text-violet',
  },
  {
    name: 'Socket.io',
    role: 'Real-time log stream',
    icon: Radio,
    accent: 'text-blue',
  },
];

export function OpenSource(): JSX.Element {
  return (
    <section id="open-source" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="glow glow-violet left-[-6rem] top-16 h-80 w-80" />
        <div className="glow glow-blue right-[-8rem] bottom-12 h-[24rem] w-[24rem] opacity-60" />
      </div>

      <Container>
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          {/* LEFT — narrative + CTAs */}
          <div className="lg:sticky lg:top-28">
            <SectionHeading
              align="left"
              eyebrow="Fully open source"
              title={
                <>
                  Open source,{' '}
                  <span className="gradient-text-brand">all the way down</span>
                </>
              }
              description="No proprietary runtime hiding under the hood. Every layer is something you can read, fork, audit, and run yourself."
            />

            <Reveal delay={180}>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink
                  href={links.github}
                  target="_blank"
                  rel="noreferrer"
                  variant="primary"
                >
                  <Github className="h-4 w-4" aria-hidden />
                  View source on GitHub
                </ButtonLink>
                <ButtonLink href={links.signup} variant="secondary">
                  Start deploying
                </ButtonLink>
              </div>
            </Reveal>

            <Reveal delay={260}>
              <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-cyan" aria-hidden />
                MIT licensed · self-hostable · audited dependencies
              </p>
            </Reveal>
          </div>

          {/* RIGHT — stack tiles */}
          <div className="grid gap-3 sm:grid-cols-2">
            {stack.map((tile, i) => (
              <Reveal key={tile.name} delay={i * 60}>
                <article className="card-surface flex h-full items-start gap-3 p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/5">
                    <tile.icon
                      className={cn('h-4 w-4', tile.accent)}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium text-foreground">
                      {tile.name}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {tile.role}
                    </p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
