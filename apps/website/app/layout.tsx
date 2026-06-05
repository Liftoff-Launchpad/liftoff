import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const title = 'Liftoff — Deploy to your own cloud. Own your infrastructure.';
const description =
  'Liftoff is an open-source Deploy-as-a-Service platform. Push code, and Liftoff builds your image and provisions DigitalOcean infrastructure in your own account via Pulumi and GitHub Actions. No black boxes. No vendor lock-in.';

export const metadata: Metadata = {
  metadataBase: new URL('https://liftoff.dev'),
  title,
  description,
  keywords: [
    'deploy as a service',
    'DigitalOcean',
    'Pulumi',
    'open source',
    'no vendor lock-in',
    'git push to deploy',
    'PaaS',
    'self-hosted deployment',
  ],
  authors: [{ name: 'Liftoff' }],
  openGraph: {
    title,
    description,
    type: 'website',
    siteName: 'Liftoff',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): JSX.Element {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
