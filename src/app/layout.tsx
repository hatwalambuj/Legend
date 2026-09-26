import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { fontVariables } from './fonts';
import './globals.css';

// OWNER: Frontend (skeleton by Architect). Header/nav/footer/attribution go here.
export const metadata: Metadata = {
  title: { default: 'Stubbed — only the good stuff', template: '%s · Stubbed' },
  description:
    'Track the movies and shows you watch. Every title here clears 6.5 on TMDB. Watch it, stub it, keep the proof.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
};

export const viewport: Viewport = {
  themeColor: '#0B0B0D',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
