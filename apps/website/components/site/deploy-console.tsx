'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Loader2,
  Hammer,
  UploadCloud,
  Boxes,
  Rocket,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { WindowFrame } from '@/components/ui/window-frame';

interface Stage {
  key: string;
  label: string;
  icon: typeof Hammer;
  logs: string[];
}

const stages: Stage[] = [
  {
    key: 'build',
    label: 'Building',
    icon: Hammer,
    logs: [
      '› Detected Dockerfile — building image',
      '✓ Compiled in 38.4s · image 142 MB',
    ],
  },
  {
    key: 'push',
    label: 'Pushing',
    icon: UploadCloud,
    logs: [
      '› Pushing to registry.digitalocean.com/acme',
      '✓ sha256:9f21c… pushed to your DOCR',
    ],
  },
  {
    key: 'provision',
    label: 'Provisioning',
    icon: Boxes,
    logs: [
      '› pulumi up — your DigitalOcean account',
      '+ app-platform:App   created',
      '+ managed:Postgres   created',
    ],
  },
  {
    key: 'deploy',
    label: 'Deploying',
    icon: Rocket,
    logs: ['› Rolling out · health checks passing', '✓ Auto HTTPS issued'],
  },
  {
    key: 'live',
    label: 'Live',
    icon: Globe,
    logs: ['✓ Deployed → https://acme-web.ondigitalocean.app'],
  },
];

export function DeployConsole(): JSX.Element {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reduce) {
      setActive(stages.length - 1);
      return;
    }
    const id = setInterval(() => {
      setActive((prev) => (prev + 1) % (stages.length + 1));
    }, 1600);
    return () => clearInterval(id);
  }, []);

  // active === stages.length is a brief "all done" beat before looping.
  const visibleCount = Math.min(active + 1, stages.length);
  const isLive = active >= stages.length - 1;

  return (
    // Decorative product illustration — hidden from assistive tech (the deploy
    // pipeline it depicts is described in plain text elsewhere on the page).
    <WindowFrame
      aria-hidden
      title={
        <div className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">liftoff</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
            production
          </span>
        </div>
      }
      rightSlot={
        <div className="hidden items-center gap-2 font-mono text-[11px] text-muted-foreground sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan" />
          git push · main@9f21c4e
        </div>
      }
    >
      <div className="grid gap-0 sm:grid-cols-[210px_1fr]">
          {/* Pipeline stepper */}
          <div className="border-b border-white/[0.06] p-4 sm:border-b-0 sm:border-r">
            <ol className="flex gap-3 sm:flex-col">
              {stages.map((stage, i) => {
                const done = i < active;
                const running = i === active && !isLive;
                const current = i === active;
                const Icon = stage.icon;
                return (
                  <li
                    key={stage.key}
                    className="flex flex-1 items-center gap-2.5 sm:flex-none"
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-500',
                        done &&
                          'border-cyan/40 bg-cyan/15 text-cyan',
                        current &&
                          'border-violet/50 bg-violet/15 text-violet glow-ring',
                        !done &&
                          !current &&
                          'border-white/10 bg-white/[0.02] text-muted-foreground/50',
                      )}
                    >
                      {done ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : running ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span
                      className={cn(
                        'hidden text-sm transition-colors duration-500 sm:block',
                        current
                          ? 'font-medium text-foreground'
                          : done
                            ? 'text-foreground/70'
                            : 'text-muted-foreground/70',
                      )}
                    >
                      {stage.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Streaming log */}
          <div className="min-h-[220px] p-4 font-mono text-[12.5px] leading-relaxed sm:text-[13px]">
            <div className="space-y-1.5">
              {stages.slice(0, visibleCount).flatMap((stage, si) =>
                stage.logs.map((line, li) => {
                  const isAdded = line.startsWith('+');
                  const isOk = line.startsWith('✓');
                  return (
                    <div
                      key={`${si}-${li}`}
                      className={cn(
                        'flex animate-fade-in items-start gap-1',
                        isOk && 'text-cyan',
                        isAdded && 'text-violet',
                        !isOk && !isAdded && 'text-muted-foreground',
                      )}
                    >
                      <span className="whitespace-pre-wrap">{line}</span>
                    </div>
                  );
                }),
              )}
              {!isLive && (
                <div className="flex items-center gap-1 text-muted-foreground/70">
                  <span className="inline-block h-3.5 w-1.5 animate-pulse bg-violet/80" />
                </div>
              )}
            </div>

            {isLive && (
              <div className="mt-4 flex animate-fade-in flex-wrap items-center gap-2 rounded-lg border border-cyan/25 bg-cyan/10 px-3 py-2 text-xs">
                <Globe className="h-3.5 w-3.5 text-cyan" />
                <span className="font-mono text-foreground">
                  acme-web.ondigitalocean.app
                </span>
                <span className="ml-auto rounded-full bg-cyan/20 px-2 py-0.5 font-medium text-cyan">
                  Live
                </span>
              </div>
            )}
          </div>
        </div>
    </WindowFrame>
  );
}
