import { cn } from '@/lib/utils';

/** Liftoff rocket glyph — gradient-filled, used in nav, footer, favicons. */
export function LogoMark({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        'relative inline-flex h-8 w-8 items-center justify-center rounded-lg',
        className,
      )}
    >
      <span
        className="absolute inset-0 rounded-lg opacity-90"
        style={{
          background:
            'linear-gradient(150deg, hsl(258 90% 66%), hsl(211 100% 55%))',
        }}
        aria-hidden
      />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="relative h-[18px] w-[18px] text-white"
        aria-hidden
      >
        <path
          d="M12 2.5c2.7 1.4 4.6 4.3 4.6 7.9 0 1.8-.5 3.4-1.3 4.8l1.6 3.2-3.2-1.1c-.5.2-1.1.3-1.7.3s-1.2-.1-1.7-.3l-3.2 1.1 1.6-3.2c-.8-1.4-1.3-3-1.3-4.8 0-3.6 1.9-6.5 4.6-7.9Z"
          fill="currentColor"
          fillOpacity="0.95"
        />
        <circle cx="12" cy="9.5" r="1.8" fill="hsl(258 90% 40%)" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[1.05rem] font-semibold tracking-tight">
        Liftoff
      </span>
    </span>
  );
}
