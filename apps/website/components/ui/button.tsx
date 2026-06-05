import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-5',
  lg: 'h-12 px-6 text-base',
};

const variants: Record<ButtonVariant, string> = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  ghost:
    'btn text-muted-foreground hover:text-foreground hover:bg-white/5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

/** Anchor styled identically to Button — for external/navigation links. */
interface ButtonLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ className, variant = 'primary', size = 'md', target, rel, ...props }, ref) => (
    <a
      ref={ref}
      target={target}
      // Always pair new-tab links with noreferrer (security + privacy).
      rel={rel ?? (target === '_blank' ? 'noreferrer' : undefined)}
      className={cn(variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
ButtonLink.displayName = 'ButtonLink';
