import {
  Boxes,
  Container as ContainerIcon,
  Database,
  Droplet,
  FileCode2,
  Github,
  Layers,
  ListChecks,
  Network,
  Package,
  PanelsTopLeft,
  Server,
  type LucideIcon,
} from 'lucide-react';
import { Container } from '@/components/ui/container';

type TechItem = {
  label: string;
  Icon: LucideIcon;
};

const TECH: readonly TechItem[] = [
  { label: 'Docker', Icon: ContainerIcon },
  { label: 'Pulumi', Icon: Boxes },
  { label: 'GitHub Actions', Icon: Github },
  { label: 'Nixpacks', Icon: Package },
  { label: 'Next.js', Icon: PanelsTopLeft },
  { label: 'NestJS', Icon: Server },
  { label: 'PostgreSQL', Icon: Database },
  { label: 'Redis', Icon: Layers },
  { label: 'BullMQ', Icon: ListChecks },
  { label: 'Prisma', Icon: Network },
  { label: 'DigitalOcean', Icon: Droplet },
  { label: 'TypeScript', Icon: FileCode2 },
];

function TechRow({ ariaHidden }: { ariaHidden?: boolean }): JSX.Element {
  return (
    <ul
      className="flex w-max shrink-0 items-center gap-10 pr-10 sm:gap-12 sm:pr-12"
      aria-hidden={ariaHidden}
    >
      {TECH.map(({ label, Icon }) => (
        <li
          key={label}
          className="group flex shrink-0 items-center gap-2.5 text-muted-foreground transition-colors duration-200 hover:text-foreground"
        >
          <Icon
            className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors duration-200 group-hover:text-foreground"
            strokeWidth={1.75}
          />
          <span className="whitespace-nowrap font-mono text-sm font-medium tracking-tight">
            {label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TechMarquee(): JSX.Element {
  return (
    <section className="relative py-12 sm:py-16">
      <Container>
        <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground sm:text-[0.8125rem]">
          Built entirely on open source &mdash; nothing proprietary, nothing to
          get locked into.
        </p>

        <div className="marquee-mask mt-8 overflow-hidden sm:mt-10">
          <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
            <TechRow />
            <TechRow ariaHidden />
          </div>
        </div>
      </Container>
    </section>
  );
}
