import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { AuthPage } from '@/components/AuthPage';
import { NEUTRAL_PALETTE } from '@/lib/images';

// OWNER: Frontend. Direct-URL fallback for the auth sheet (DESIGN §7.6). ?next=&action=
export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function Page() {
  return (
    <>
      <AdaptiveBackground palette={NEUTRAL_PALETTE} />
      <Suspense>
        <AuthPage initialView="signin" />
      </Suspense>
    </>
  );
}
