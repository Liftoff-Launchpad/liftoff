import { cn } from '@/lib/utils';

interface WindowFrameProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Left-aligned chrome content (after the traffic lights), e.g. a filename. */
  title: React.ReactNode;
  /** Optional right-aligned chrome slot, e.g. a status indicator. */
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared editor/terminal window chrome — animated gradient border, dark panel,
 * and a macOS-style traffic-light title bar. Used by the hero deploy console
 * and the liftoff.yml config showcase so the chrome can't drift between them.
 */
export function WindowFrame({
  title,
  rightSlot,
  className,
  children,
  ...props
}: WindowFrameProps): JSX.Element {
  return (
    <div
      className={cn(
        'border-gradient overflow-hidden shadow-2xl shadow-black/60',
        className,
      )}
      {...props}
    >
      <div className="rounded-[calc(var(--radius)-1px)] bg-[hsl(240_9%_6%)]">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          {title}
          {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
