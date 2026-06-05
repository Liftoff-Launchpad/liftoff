import { cn } from '@/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional leading dot color (tailwind text-* token), e.g. "text-cyan". */
  dotClassName?: string;
}

/** Small glass eyebrow pill used above section headings. */
export function Badge({
  className,
  children,
  dotClassName,
  ...props
}: BadgeProps): JSX.Element {
  return (
    <span className={cn('pill', className)} {...props}>
      {dotClassName && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-current',
            dotClassName,
          )}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
