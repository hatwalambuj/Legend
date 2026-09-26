import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { preconnect } from 'react-dom';
import { AppProvider } from '@/components/AppProvider';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { dal } from '@/server/dal';
import { today } from '@/server/env';
import { fontVariables } from './fonts';
import './globals.css';

// OWNER: Frontend. App shell: header, main, footer (attribution), mobile tab bar, client provider.
// Dynamic SSR everywhere (ADR-001): the demo pill and image mode are resolved from runtime env.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Stubbed — only the good stuff', template: '%s · Stubbed' },
  description:
    'Track the movies and shows you watch. Every title here clears 6.5 on TMDB. Watch it, stub it, keep the proof.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  icons: { icon: '/favicon.svg' },
  openGraph: { siteName: 'Stubbed', type: 'website' },
};

export const viewport: Viewport = {
  themeColor: '#0B0B0D',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const mode = dal.getMode();
  if (mode.images === 'tmdb') preconnect('https://image.tmdb.org');
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <AppProvider mode={mode} today={today()}>
          <Header isDemo={mode.isDemo} demoResets={mode.demoResets ?? false} />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
          <TabBar />
        </AppProvider>
      </body>
    </html>
  );
}
