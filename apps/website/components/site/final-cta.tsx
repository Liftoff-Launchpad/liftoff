import { ArrowRight, Check, Github, Rocket } from 'lucide-react';
import { links } from '@/lib/utils';
import { Container } from '@/components/ui/container';
import { ButtonLink } from '@/components/ui/button';
import { Reveal } from '@/components/ui/reveal';
import { Badge } from '@/components/ui/badge';

const reassurances = [
  'Free & open source',
  'Your DigitalOcean account',
  'No credit card',
];

export function FinalCta(): JSX.Element {
  return (
    <section className="relative py-24 sm:py-32">
      <Container>
        <Reveal>
          <div className="border-gradient animate-border-flow">
            <div className="relative overflow-hidden rounded-[calc(var(--radius)-1px)] bg-background px-6 py-16 grid-bg sm:px-16 sm:py-20">
              {/* Glow field behind the content */}
              <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <div className="glow glow-violet left-1/2 top-[-4rem] h-80 w-80 -translate-x-1/2 animate-pulse-glow" />
                <div className="glow glow-cyan bottom-[-5rem] right-[-3rem] h-64 w-64" />
              </div>

              <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
                <Reveal>
                  <Badge className="hover:border-white/20">
                    <Rocket className="h-3.5 w-3.5 text-violet" aria-hidden />
                    Ready for liftoff
                  </Badge>
                </Reveal>

                <Reveal delay={70}>
                  <h2 className="mt-6 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
                    Ship your next deploy on
                    <br />
                    <span className="gradient-text-brand">
                      infrastructure you own.
                    </span>
                  </h2>
                </Reveal>

                <Reveal delay={140}>
                  <p className="mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
                    Connect DigitalOcean and GitHub, push your code, and watch it
                    go live — in minutes, with zero lock-in.
                  </p>
                </Reveal>

                <Reveal delay={210}>
                  <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                    <ButtonLink href={links.signup} size="lg" className="group">
                      Start deploying free
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </ButtonLink>
                    <ButtonLink
                      href={links.github}
                      target="_blank"
                      rel="noreferrer"
                      variant="secondary"
                      size="lg"
                    >
                      <Github className="h-[18px] w-[18px]" />
                      Star on GitHub
                    </ButtonLink>
                  </div>
                </Reveal>

                <Reveal delay={280}>
                  <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
                    {reassurances.map((item) => (
                      <li key={item} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-cyan" aria-hidden />
                        {item}
                      </li>
                    ))}
                  </ul>
                </Reveal>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
