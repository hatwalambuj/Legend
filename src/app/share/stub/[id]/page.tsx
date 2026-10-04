/**
 * Shared stub landing (ADR-013 C-08): the ticket + "Stub it" CTA. `robots: noindex`, canonical = the
 * title page. Shows only the title, stub number, season, date and the owner's handle/name: never the
 * note or any review text. The og:image comes from ./opengraph-image.tsx. OWNER: Frontend.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { formatDate } from '@/components/lib/display';
import { Ticket } from '@/components/Ticket';
import { BRAND_NAME } from '@/lib/brand';
import { seasonLabel } from '@/lib/format';
import { paletteOrDefault } from '@/lib/images';
import { parseTitleKey } from '@/lib/keys';
import { profileHref, titleHref } from '@/lib/routes';
import { dal } from '@/server/dal';
import styles from './share.module.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

const load = cache(async (id: string) => {
  const share = await dal.getStubShare(id);
  const ref = share ? parseTitleKey(share.title.key) : null;
  if (!share || !ref) return null;
  const title = await dal.getTitle(ref.mediaType, ref.tmdbId);
  return title ? { share, title } : null;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load((await params).id);
  if (!data) return { title: "This ticket doesn't exist", robots: { index: false } };
  const { share, title } = data;
  const name = `@${share.handle} stubbed ${title.title} (${title.year})`;
  return {
    title: name,
    description: `${title.title} on ${BRAND_NAME}: only titles rated 6.5+ on TMDB.`,
    robots: { index: false, follow: true },
    alternates: { canonical: titleHref(title) },
    openGraph: { title: name, type: 'website' },
  };
}

export default async function ShareStubPage({ params }: { params: Params }) {
  const data = await load((await params).id);
  if (!data) notFound();
  const { share, title } = data;
  const season = title.mediaType === 'tv' ? seasonLabel(share.season) : '';
  const palette = paletteOrDefault(
    title.palette,
    title.genres.map((g) => g.id),
  );
  return (
    <>
      <AdaptiveBackground palette={palette} />
      <div className={`wrap ${styles.page}`}>
        <div className="page-h">
          <div className="eyebrow">
            {share.number > 1 ? `Stub #${share.number} · rewatch` : 'Stub #1'}
            {season && ` · ${season}`}
          </div>
          <h1>
            <Link href={profileHref(share.handle)}>@{share.handle}</Link> stubbed {title.title}
          </h1>
          <p data-testid="share-stub-meta">
            Watched {formatDate(share.watchedOn)}. Every title on {BRAND_NAME} clears 6.5 on TMDB.
          </p>
        </div>
        <div className={styles.ticket}>
          <Ticket title={title} variant="grid" priority />
        </div>
        <div className={styles.actions}>
          <Link className="btn btn--primary" href={titleHref(title)} data-testid="share-stub-cta">
            Stub it yourself
          </Link>
          <Link className="btn btn--ghost" href={profileHref(share.handle)}>
            See {share.displayName}&apos;s wallet
          </Link>
        </div>
      </div>
    </>
  );
}
