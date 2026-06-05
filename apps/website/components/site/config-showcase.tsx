import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Container } from '@/components/ui/container';
import { Reveal } from '@/components/ui/reveal';
import { SectionHeading } from '@/components/ui/section-heading';
import { WindowFrame } from '@/components/ui/window-frame';

interface Highlight {
  label: string;
  detail: string;
}

const highlights: Highlight[] = [
  {
    label: 'Dockerfile-first builds',
    detail:
      'Bring your own Dockerfile, or let Nixpacks detect the build automatically.',
  },
  {
    label: 'Managed add-ons',
    detail:
      'Flip on Postgres or Spaces and Liftoff provisions and wires them in.',
  },
  {
    label: 'Secrets, handled',
    detail:
      'Declared secrets are injected as encrypted env vars on App Platform.',
  },
  {
    label: 'Health checks',
    detail:
      'Define a health path; rollouts wait for it to pass before going live.',
  },
];

type StageTone = 'muted' | 'progress' | 'success';

interface Stage {
  label: string;
  tone: StageTone;
}

const stages: Stage[] = [
  { label: 'PENDING', tone: 'muted' },
  { label: 'QUEUED', tone: 'muted' },
  { label: 'BUILDING', tone: 'progress' },
  { label: 'PUSHING', tone: 'progress' },
  { label: 'PROVISIONING', tone: 'progress' },
  { label: 'DEPLOYING', tone: 'progress' },
  { label: 'SUCCESS', tone: 'success' },
];

const stageTone: Record<StageTone, string> = {
  muted:
    'border-white/10 bg-white/[0.02] text-muted-foreground/70',
  progress:
    'border-violet/30 bg-violet/10 text-violet/90',
  success: 'border-cyan/40 bg-cyan/10 text-cyan',
};

/** Code-as-config showcase: liftoff.yml editor window + deploy state machine. */
export function ConfigShowcase(): JSX.Element {
  return (
    <section id="config" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="glow glow-violet right-1/3 top-1/4 h-80 w-80" />
        <div className="glow glow-blue bottom-0 left-1/4 h-64 w-64" />
      </div>

      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* LEFT — narrative + highlights */}
          <div>
            <SectionHeading
              align="left"
              eyebrow="Config as code"
              eyebrowDot="text-violet"
              title={
                <>
                  One file.{' '}
                  <span className="gradient-text-brand">Total control.</span>
                </>
              }
              description="Describe your service, build, runtime, env and add-ons in a single liftoff.yml at your repo root. It's validated with Zod and versioned with your code — no dashboards to click through."
            />

            <ul className="mt-8 space-y-4">
              {highlights.map((item, i) => (
                <li key={item.label}>
                  <Reveal delay={i * 70} className="flex items-start gap-3.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-violet/30 bg-violet/15 text-violet">
                      <Check className="h-4 w-4" aria-hidden />
                    </span>
                    <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                      <span className="font-semibold text-foreground">
                        {item.label}
                      </span>{' '}
                      — {item.detail}
                    </p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>

          {/* RIGHT — liftoff.yml editor window */}
          <Reveal delay={120}>
            <WindowFrame
              title={
                <div className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">repo</span>
                  <span className="text-muted-foreground/40">/</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
                    liftoff.yml
                  </span>
                </div>
              }
            >
              {/* YAML body */}
              <pre className="overflow-x-auto whitespace-pre p-4 font-mono text-[12.5px] leading-relaxed">
                  <code>
                    <Key>version</Key>
                    <Punct>: </Punct>
                    <Str>&quot;1.0&quot;</Str>
                    {'\n'}
                    <Key>service</Key>
                    <Punct>:</Punct>
                    {'\n  '}
                    <Key>name</Key>
                    <Punct>: </Punct>
                    <Str>my-webapp</Str>
                    {'\n  '}
                    <Key>type</Key>
                    <Punct>: </Punct>
                    <Str>app</Str>
                    <Comment>            # DigitalOcean App Platform</Comment>
                    {'\n  '}
                    <Key>region</Key>
                    <Punct>: </Punct>
                    <Str>nyc3</Str>
                    {'\n'}
                    <Key>build</Key>
                    <Punct>:</Punct>
                    {'\n  '}
                    <Key>strategy</Key>
                    <Punct>: </Punct>
                    <Str>auto</Str>
                    <Comment>       # Dockerfile-first, Nixpacks fallback</Comment>
                    {'\n'}
                    <Key>runtime</Key>
                    <Punct>:</Punct>
                    {'\n  '}
                    <Key>instance_size</Key>
                    <Punct>: </Punct>
                    <Str>apps-s-1vcpu-0.5gb</Str>
                    {'\n  '}
                    <Key>replicas</Key>
                    <Punct>: </Punct>
                    <Num>2</Num>
                    {'\n  '}
                    <Key>port</Key>
                    <Punct>: </Punct>
                    <Num>3000</Num>
                    {'\n'}
                    <Key>database</Key>
                    <Punct>:</Punct>
                    {'\n  '}
                    <Key>enabled</Key>
                    <Punct>: </Punct>
                    <Bool>true</Bool>
                    {'\n  '}
                    <Key>engine</Key>
                    <Punct>: </Punct>
                    <Str>postgres</Str>
                    {'\n  '}
                    <Key>version</Key>
                    <Punct>: </Punct>
                    <Str>&quot;15&quot;</Str>
                    {'\n'}
                    <Key>healthcheck</Key>
                    <Punct>:</Punct>
                    {'\n  '}
                    <Key>path</Key>
                    <Punct>: </Punct>
                    <Str>/health</Str>
                  </code>
              </pre>
            </WindowFrame>
          </Reveal>
        </div>

        {/* Deploy state machine */}
        <div className="mt-16">
          <Reveal>
            <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Every deploy, fully observable
            </p>
          </Reveal>
          <Reveal delay={80}>
            <ol className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {stages.map((stage, i) => (
                <li key={stage.label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs',
                      stageTone[stage.tone],
                    )}
                  >
                    {stage.tone === 'success' && (
                      <Check className="h-3 w-3" aria-hidden />
                    )}
                    {stage.label}
                  </span>
                  {i < stages.length - 1 && (
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
                      aria-hidden
                    />
                  )}
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

/* ── YAML token spans (presentational, no state) ─────────────────────── */

function Key({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="text-violet">{children}</span>;
}

function Str({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="text-cyan">{children}</span>;
}

function Num({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="text-cyan">{children}</span>;
}

function Bool({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="text-amber">{children}</span>;
}

function Comment({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="text-muted-foreground/80">{children}</span>;
}

function Punct({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="text-foreground/70">{children}</span>;
}
