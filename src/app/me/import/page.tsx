import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { ImportFlow } from '@/components/ImportFlow';
import { NEUTRAL_PALETTE } from '@/lib/images';
import { importHref } from '@/lib/routes';
import { dal } from '@/server/dal';

// OWNER: Frontend. Import (ADR-013 C-11): owner-only; the file is parsed in the browser.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Import', robots: { index: false } };

export default async function ImportPage() {
  const session = await dal.getSession();
  if (!session) redirect(`/signin?next=${encodeURIComponent(importHref())}`);
  return (
    <>
      <AdaptiveBackground palette={NEUTRAL_PALETTE} />
      <div className="wrap">
        <div className="page-h">
          <div className="eyebrow">@{session.user.handle}</div>
          <h1>Import your history</h1>
          <p>
            Letterboxd, IMDb ratings or TV Time. We match titles against our own catalogue and never
            contact those sites.
          </p>
        </div>
        <ImportFlow handle={session.user.handle} />
      </div>
    </>
  );
}
