'use client';

import { useEffect, useState } from 'react';
import { Github, Menu, X } from 'lucide-react';
import { cn, links } from '@/lib/utils';
import { Container } from '@/components/ui/container';
import { ButtonLink } from '@/components/ui/button';
import { Wordmark } from '@/components/ui/logo';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Open source', href: '#open-source' },
  { label: 'Config', href: '#config' },
];

export function Nav(): JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'border-b border-white/[0.06] bg-background/70 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-4">
        <a href="#top" className="shrink-0" aria-label="Liftoff home">
          <Wordmark />
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <a
            href={links.github}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            aria-label="GitHub"
          >
            <Github className="h-[18px] w-[18px]" />
          </a>
          <a
            href={links.login}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </a>
          <ButtonLink href={links.signup} size="sm">
            Get started
          </ButtonLink>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </Container>

      {/* Mobile sheet — content is unmounted while closed so its links stay
          out of the keyboard tab order. */}
      <div
        id="mobile-nav"
        aria-hidden={!open}
        className={cn(
          'overflow-hidden border-t bg-background/95 backdrop-blur-xl transition-[max-height,opacity] duration-300 md:hidden',
          open
            ? 'max-h-[420px] border-white/[0.06] opacity-100'
            : 'max-h-0 border-transparent opacity-0',
        )}
      >
        {open && (
          <Container className="flex flex-col gap-1 py-4">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <ButtonLink
                href={links.login}
                variant="secondary"
                className="w-full"
              >
                Sign in
              </ButtonLink>
              <ButtonLink href={links.signup} className="w-full">
                Get started
              </ButtonLink>
            </div>
          </Container>
        )}
      </div>
    </header>
  );
}
