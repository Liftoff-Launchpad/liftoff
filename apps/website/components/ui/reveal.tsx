'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface RevealProps extends React.HTMLAttributes<HTMLElement> {
  /** Stagger delay in ms before the element animates in. */
  delay?: number;
  /** Render as a different element if needed (defaults to div). */
  as?: 'div' | 'li' | 'span' | 'section';
}

/**
 * Scroll-triggered fade-up. Adds `.is-visible` once the element enters the
 * viewport (one-shot). Pairs with the `.reveal` utility in globals.css and
 * gracefully no-ops under prefers-reduced-motion.
 */
export function Reveal({
  className,
  children,
  delay = 0,
  as = 'div',
  style,
  ...props
}: RevealProps): JSX.Element {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Component = as as React.ElementType;

  return (
    <Component
      ref={ref}
      className={cn('reveal', visible && 'is-visible', className)}
      style={{ transitionDelay: `${delay}ms`, ...style }}
      {...props}
    >
      {children}
    </Component>
  );
}
