import { ArrowRight, Github, Cloud, GitBranch, Lock } from 'lucide-react';
import { links } from '@/lib/utils';
import { Container } from '@/components/ui/container';
import { ButtonLink } from '@/components/ui/button';
import { Reveal } from '@/components/ui/reveal';
import { Badge } from '@/components/ui/badge';
import { DeployConsole } from '@/components/site/deploy-console';

const trustItems = [
  { icon: Cloud, label: 'Your DigitalOcean account' },
  { icon: GitBranch, label: 'Git push to deploy' },
  { icon: Lock, label: 'Zero lock-in' },
];

export function Hero(): JSX.Element {
  return (
    <section id="top" className="relative overflow-hidden pt-32 sm:pt-40">
      {/* Background field */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 grid-bg grid-bg-fade" />
        <div className="glow glow-violet left-1/2 top-[-6rem] h-[34rem] w-[34rem] -translate-x-1/2 animate-pulse-glow" />
        <div className="glow glow-blue right-[-6rem] top-24 h-[24rem] w-[24rem]" />
        <div className="glow glow-cyan left-[-6rem] top-40 h-[20rem] w-[20rem]" />
      </div>

      <Container className="flex flex-col items-center text-center">
        <Reveal>
          <a href="#open-source" className="group">
            <Badge dotClassName="text-cyan" className="hover:border-white/20">
              <span className="text-foreground">100% open source</span>
              <span className="text-muted-foreground/60">·</span>
              No vendor lock-in
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </Badge>
          </a>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="mt-6 max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-[4.25rem]">
            Deploy to your own cloud.
            <br />
            <span className="gradient-text-brand">Own your infrastructure.</span>
          </h1>
        </Reveal>

        <Reveal delay={150}>
          <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground sm:text-xl">
            Liftoff builds your image and provisions DigitalOcean infrastructure
            in <span className="text-foreground">your own account</span> — with
            Pulumi, Docker, and GitHub Actions. Push code, get a live URL. No
            black boxes, nothing to get locked into.
          </p>
        </Reveal>

        <Reveal delay={220}>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
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

        <Reveal delay={300}>
          <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            {trustItems.map((item) => (
              <li key={item.label} className="flex items-center gap-2">
                <item.icon className="h-4 w-4 text-violet" />
                {item.label}
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>

      {/* Hero product visual */}
      <Reveal delay={120} className="mt-16 sm:mt-20">
        <Container className="relative">
          <div className="glow glow-violet left-1/2 top-10 h-72 w-[40rem] max-w-full -translate-x-1/2 opacity-60" />
          <div className="relative mx-auto max-w-4xl">
            <DeployConsole />
          </div>
          {/* Fade the bottom into the page */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-32 bg-gradient-to-b from-transparent to-background" />
        </Container>
      </Reveal>
    </section>
  );
}
