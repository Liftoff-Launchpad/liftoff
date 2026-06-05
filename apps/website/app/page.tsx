import { Nav } from '@/components/site/nav';
import { Hero } from '@/components/site/hero';
import { TechMarquee } from '@/components/site/tech-marquee';
import { NoLockIn } from '@/components/site/no-lock-in';
import { Features } from '@/components/site/features';
import { HowItWorks } from '@/components/site/how-it-works';
import { ConfigShowcase } from '@/components/site/config-showcase';
import { OpenSource } from '@/components/site/open-source';
import { FinalCta } from '@/components/site/final-cta';
import { Footer } from '@/components/site/footer';

export default function HomePage(): JSX.Element {
  return (
    <>
      <Nav />
      <main className="relative">
        <Hero />
        <TechMarquee />
        <NoLockIn />
        <Features />
        <HowItWorks />
        <ConfigShowcase />
        <OpenSource />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
