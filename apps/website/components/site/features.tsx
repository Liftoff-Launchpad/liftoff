import {
  GitBranch,
  Workflow,
  Cloud,
  ScrollText,
  Cable,
  FileCode2,
  Layers,
  Gauge,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Reveal } from '@/components/ui/reveal';
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';

interface Feature {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Icon accent tint, e.g. "text-violet". */
  accent: string;
}

const features: Feature[] = [
  {
    title: 'Visual service canvas',
    description:
      'Add services, databases, caches and buckets on a graph, then wire them together — drag, drop, connect.',
    icon: Workflow,
    accent: 'text-blue',
  },
  {
    title: 'Real DigitalOcean infra',
    description:
      'App Platform, Managed PostgreSQL & Redis, Spaces and DOCR — with automatic HTTPS via Let’s Encrypt.',
    icon: Cloud,
    accent: 'text-cyan',
  },
  {
    title: 'Live deploy logs',
    description:
      'Build and provision output streamed in real time over WebSockets, with a clear state machine from queued to live.',
    icon: ScrollText,
    accent: 'text-violet',
  },
  {
    title: 'Auto-wired services',
    description:
      'Connect a database or cache and Liftoff injects the env vars and internal URLs your app needs — no copy-paste.',
    icon: Cable,
    accent: 'text-blue',
  },
  {
    title: 'Config as code',
    description:
      'A single liftoff.yml at your repo root, validated with Zod. Your deploy config lives with your code.',
    icon: FileCode2,
    accent: 'text-cyan',
  },
  {
    title: 'Multi-repo, multi-env',
    description:
      'Environments map to branches across one or many repos. Promote from preview to production with a push.',
    icon: Layers,
    accent: 'text-violet',
  },
  {
    title: 'Metrics & scaling',
    description:
      'Per-service CPU, memory and restart metrics, with replica scaling from 1 to 10 instances.',
    icon: Gauge,
    accent: 'text-blue',
  },
];

function IconTile({
  icon: Icon,
  accent,
}: {
  icon: LucideIcon;
  accent: string;
}): JSX.Element {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/5">
      <Icon className={cn('h-5 w-5', accent)} aria-hidden />
    </div>
  );
}

export function Features(): JSX.Element {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="glow glow-blue right-[-8rem] top-24 h-[26rem] w-[26rem]" />
        <div className="glow glow-violet left-[-6rem] bottom-10 h-72 w-72 opacity-60" />
      </div>

      <Container>
        <SectionHeading
          eyebrow="Capabilities"
          title={
            <>
              Everything you need to{' '}
              <span className="gradient-text-brand">ship</span>
            </>
          }
          description="From a git push to a load-balanced, HTTPS app on DigitalOcean — with the workflow and observability you'd expect from a modern platform."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Featured card */}
          <Reveal className="sm:col-span-2 lg:col-span-2 lg:row-span-1">
            <article className="card-surface flex h-full flex-col p-8">
              <IconTile icon={GitBranch} accent="text-violet" />
              <h3 className="mt-5 text-lg font-semibold">Git push to deploy</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Connect a repo and every push to a tracked branch triggers an
                automatic build and deploy. Webhooks are registered for you.
              </p>

              <div className="mt-6 rounded-lg border border-white/[0.08] bg-black/30 p-3 font-mono text-xs">
                <div className="text-foreground">
                  <span className="text-muted-foreground/70">$</span> git push
                  origin main
                </div>
                <div className="mt-2 flex items-center gap-2 text-muted-foreground/80">
                  <span className="text-violet">→</span>
                  <span>deploy #128 · building…</span>
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin text-violet"
                    aria-hidden
                  />
                </div>
              </div>
            </article>
          </Reveal>

          {/* Remaining cards */}
          {features.map((feature, i) => (
            <Reveal key={feature.title} delay={(i + 1) * 70}>
              <article className="card-surface flex h-full flex-col p-6">
                <IconTile icon={feature.icon} accent={feature.accent} />
                <h3 className="mt-5 text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
