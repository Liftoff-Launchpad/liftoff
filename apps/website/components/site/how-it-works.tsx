import { Plug, GitCommitHorizontal, Boxes, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Container } from '@/components/ui/container';
import { Reveal } from '@/components/ui/reveal';
import { SectionHeading } from '@/components/ui/section-heading';

interface Step {
  number: string;
  title: string;
  description: string;
  icon: typeof Plug;
  /** Cyan success accent for the final "Live" step. */
  accent?: boolean;
}

const steps: Step[] = [
  {
    number: '01',
    title: 'Connect',
    description:
      'Add your DigitalOcean token (encrypted, AES-256-GCM) and link a GitHub repo. Webhooks are registered automatically.',
    icon: Plug,
  },
  {
    number: '02',
    title: 'Push',
    description:
      'Push to a tracked branch. A GitHub webhook tells Liftoff to start a deployment — no manual triggers.',
    icon: GitCommitHorizontal,
  },
  {
    number: '03',
    title: 'Build & provision',
    description:
      'Liftoff builds your image (Dockerfile-first, Nixpacks fallback), pushes to your DOCR, then runs Pulumi against your account.',
    icon: Boxes,
  },
  {
    number: '04',
    title: 'Live',
    description:
      'Your app is on DigitalOcean App Platform with auto HTTPS, logs and metrics. You own every resource.',
    icon: Globe,
    accent: true,
  },
];

export function HowItWorks(): JSX.Element {
  return (
    <section id="how-it-works" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="glow glow-violet left-[-4rem] top-24 h-72 w-72" />
        <div className="glow glow-blue left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 opacity-60" />
        <div className="glow glow-cyan right-[-4rem] bottom-16 h-72 w-72" />
      </div>

      <Container>
        <SectionHeading
          eyebrow="How it works"
          title={
            <>
              From git push to live in{' '}
              <span className="gradient-text-brand">four steps</span>
            </>
          }
          description="No YAML pipelines to babysit, no servers to SSH into. Connect once, then just push."
        />

        <div className="relative mt-16">
          {/* Flow connector — vertical on mobile, horizontal on lg, behind cards. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -z-10 left-12 top-12 bottom-12 w-px bg-gradient-to-b from-violet/40 via-blue/30 to-cyan/40 opacity-70 lg:inset-x-12 lg:bottom-auto lg:top-12 lg:h-px lg:w-auto lg:bg-gradient-to-r"
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            {steps.map((step, i) => (
              <Reveal key={step.number} delay={i * 90}>
                <article
                  className={cn(
                    'card-surface group relative flex h-full flex-row items-start gap-5 p-6 lg:flex-col lg:gap-6',
                    step.accent && 'hover:border-cyan/30',
                  )}
                >
                  {/* Icon tile + number badge */}
                  <div className="flex shrink-0 items-center gap-3 lg:w-full lg:justify-between">
                    <div
                      className={cn(
                        'glow-ring relative flex h-12 w-12 items-center justify-center rounded-xl border bg-white/[0.02] transition-colors',
                        step.accent
                          ? 'border-cyan/30 text-cyan group-hover:border-cyan/50'
                          : 'border-white/10 text-violet group-hover:border-violet/40',
                      )}
                    >
                      <step.icon className="h-5 w-5" strokeWidth={1.75} />
                      <div
                        className={cn(
                          'glow absolute inset-0 -z-10 opacity-50',
                          step.accent ? 'glow-cyan' : 'glow-violet',
                        )}
                      />
                    </div>
                    <span
                      className={cn(
                        'font-mono text-sm tabular-nums',
                        step.accent ? 'text-cyan/80' : 'text-muted-foreground/80',
                      )}
                    >
                      {step.number}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {step.description}
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
