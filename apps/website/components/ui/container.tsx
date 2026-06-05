import { cn } from '@/lib/utils';

export function Container({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('mx-auto w-full max-w-screen-content px-6', className)}
      {...props}
    >
      {children}
    </div>
  );
}
