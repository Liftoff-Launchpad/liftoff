import { Boxes, Check, DoorOpen, KeyRound, Rocket, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Container } from '@/components/ui/container';
import { Reveal } from '@/components/ui/reveal';
import { SectionHeading } from '@/components/ui/section-heading';

const typicalPoints = [
  'Runs in the vendor’s account',
  'Opaque, proprietary runtime',
  'Your data is trapped behind their API',
  'Leave, and your apps vanish',
];

const liftoffPoints = [
  'Runs in your DigitalOcean account',
  'Standard Docker images + Pulumi IaC',
  'You hold the DO token and own the data',
  'Delete Liftoff — your apps keep serving',
];

const guarantees = [
  {
    icon: KeyRound,
    label: 'Your credentials',
    description: 'Your DO token, encrypted with AES-256-GCM. Revoke anytime.',
    accent: 'border-violet/20 bg-violet/10 text-violet',
  },
  {
    icon: Boxes,
    label: 'Standard tooling',
    description:
      'Plain Pulumi stacks and Docker images. No magic, fully inspectable.',
    accent: 'border-blue/20 bg-blue/10 text-blue',
  },
  {
    icon: DoorOpen,
    label: 'Walk-away freedom',
    description: 'Every resource lives in your cloud. No exit tax, ever.',
    accent: 'border-cyan/20 bg-cyan/10 text-cyan',
  },
];

export function NoLockIn(): JSX.Element {
  return (
    <section id="no-lock-in" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="glow glow-violet left-1/2 top-0 h-80 w-80 -translate-x-1/2" />
      </div>

      <Container>
        <SectionHeading
          align="center"
          eyebrow="Yours, not ours"
          eyebrowDot="text-violet"
          title={
            <>
              No vendor lock-in.{' '}
              <span className="gradient-text-brand">By design.</span>
            </>
          }
          description="Liftoff provisions everything into your own DigitalOcean account with standard, open tools. Cancel Liftoff tomorrow and your apps keep running — because they were never ours to hold hostage."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-2 lg:gap-6">
          {/* Typical PaaS — dim/neutral */}
          <Reveal>
            <div className="card-surface flex h-full flex-col p-7 sm:p-8">
              <div className="flex items-center gap-2.5">
                <span className="pill text-xs font-medium text-muted-foreground">
                  Typical PaaS
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-muted-foreground">
                Rented, opaque, and reversible only on their terms
              </h3>
              <ul className="mt-6 space-y-3.5">
                {typicalPoints.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.03] text-muted-foreground">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="text-sm leading-relaxed text-muted-foreground">
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* Liftoff — highlighted with animated gradient border */}
          <Reveal delay={70}>
            <div className="border-gradient glow-ring h-full transition-transform duration-500 ease-out hover:-translate-y-[3px]">
              <div className="relative flex h-full flex-col rounded-[calc(var(--radius)-1px)] bg-card p-7 sm:p-8">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-violet/30 bg-violet/15 text-violet">
                    <Rocket className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold tracking-tight text-foreground">
                    Liftoff
                  </span>
                  <Badge dotClassName="text-violet" className="ml-auto">
                    Your cloud
                  </Badge>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-foreground">
                  Owned, standard, and yours to keep
                </h3>
                <ul className="mt-6 space-y-3.5">
                  {liftoffPoints.map((point) => (
                    <li key={point} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan/30 bg-gradient-to-br from-violet/20 to-cyan/20 text-cyan">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="text-sm leading-relaxed text-foreground/90">
                        {point}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Guarantee chips */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {guarantees.map(({ icon: Icon, label, description, accent }, index) => (
            <Reveal key={label} delay={140 + index * 70}>
              <div className="card-surface flex h-full flex-col p-6">
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl border',
                    accent,
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h4 className="mt-4 text-sm font-semibold text-foreground">
                  {label}
                </h4>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
