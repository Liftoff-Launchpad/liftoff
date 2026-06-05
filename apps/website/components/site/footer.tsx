import { Github } from 'lucide-react';
import { links } from '@/lib/utils';
import { Container } from '@/components/ui/container';
import { Wordmark } from '@/components/ui/logo';

const columns = [
  {
    title: 'Product',
    items: [
      { label: 'Features', href: '#features' },
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Configuration', href: '#config' },
      { label: 'Open source', href: '#open-source' },
    ],
  },
  {
    title: 'Built on',
    items: [
      { label: 'DigitalOcean', href: 'https://www.digitalocean.com' },
      { label: 'Pulumi', href: 'https://www.pulumi.com' },
      { label: 'Docker', href: 'https://www.docker.com' },
      { label: 'GitHub Actions', href: 'https://github.com/features/actions' },
    ],
  },
  {
    title: 'Get started',
    items: [
      { label: 'Sign in', href: links.login },
      { label: 'Deploy a repo', href: links.signup },
      { label: 'GitHub', href: links.github },
    ],
  },
];

export function Footer(): JSX.Element {
  return (
    <footer className="relative border-t border-white/[0.06]">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="glow glow-violet bottom-[-10rem] left-1/2 h-72 w-[40rem] -translate-x-1/2 opacity-40" />
      </div>
      <Container className="py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-4">
            <Wordmark />
            <p className="max-w-xs text-sm text-muted-foreground">
              Open-source Deploy-as-a-Service. Your code, your DigitalOcean
              account, your infrastructure — no lock-in.
            </p>
            <a
              href={links.github}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-2 rounded-md border border-white/10 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              View source
            </a>
          </div>

          {columns.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <span className="text-sm font-medium text-foreground">
                {col.title}
              </span>
              <ul className="flex flex-col gap-2.5">
                {col.items.map((item) => {
                  const external = item.href.startsWith('http');
                  return (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        {...(external
                          ? { target: '_blank', rel: 'noreferrer' }
                          : {})}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="rule mt-12" />
        <div className="mt-6 flex flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Liftoff. Open source under MIT.</p>
          <p className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan" />
            Everything runs on DigitalOcean — no AWS, anywhere.
          </p>
        </div>
      </Container>
    </footer>
  );
}
