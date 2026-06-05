import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Reveal } from '@/components/ui/reveal';

interface SectionHeadingProps {
  eyebrow?: string;
  eyebrowDot?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'center' | 'left';
  className?: string;
}

/** Consistent section header: eyebrow pill → title → description. */
export function SectionHeading({
  eyebrow,
  eyebrowDot = 'text-violet',
  title,
  description,
  align = 'center',
  className,
}: SectionHeadingProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        align === 'center'
          ? 'items-center text-center'
          : 'items-start text-left',
        className,
      )}
    >
      {eyebrow && (
        <Reveal>
          <Badge dotClassName={eyebrowDot}>{eyebrow}</Badge>
        </Reveal>
      )}
      <Reveal delay={60}>
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-[2.75rem] md:leading-[1.1]">
          {title}
        </h2>
      </Reveal>
      {description && (
        <Reveal delay={120}>
          <p
            className={cn(
              'max-w-2xl text-balance text-base text-muted-foreground sm:text-lg',
              align === 'center' && 'mx-auto',
            )}
          >
            {description}
          </p>
        </Reveal>
      )}
    </div>
  );
}
