/**
 * Data → card props + the `ImageResponse` wrapper for the share image routes (ADR-013 C-08). Server
 * only: fonts and the poster come from `src/server/og-assets.ts` (no fetch in demo/placeholder mode).
 * The props are explicit picks: never a note, review text or spoiler content. OWNER: Frontend.
 */
import 'server-only';
import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';
import { ticketSerial } from '@/components/lib/display';
import { seasonLabel } from '@/lib/format';
import { parseTitleKey } from '@/lib/keys';
import type { StubShareCard, TitleSummary } from '@/lib/types';
import { loadOgFonts, loadPosterDataUrl } from '@/server/og-assets';
import { dal } from '@/server/dal';
import { CARD_SIZE, ogText, type CardProps, type CardTitle } from './ShareCard';

type CardSource = Pick<
  TitleSummary,
  'mediaType' | 'title' | 'year' | 'voteAverage' | 'imdbRating' | 'posterPath' | 'palette'
> & { tmdbId: number };

async function cardTitle(t: CardSource, season: number | null): Promise<CardTitle> {
  const posterDataUri = await loadPosterDataUrl(t.posterPath, dal.getMode());
  return {
    name: ogText(t.title),
    year: t.year,
    type: t.mediaType,
    seasonsLabel: t.mediaType === 'tv' ? seasonLabel(season) || null : null,
    tmdbScore: t.voteAverage,
    imdbScore: t.imdbRating ?? null,
    posterDataUri,
    palette: t.palette,
    serial: ticketSerial(t.tmdbId),
  };
}

export async function stubCardProps(s: StubShareCard): Promise<CardProps> {
  const tmdbId = parseTitleKey(s.title.key)?.tmdbId ?? 0;
  return {
    title: await cardTitle({ ...s.title, tmdbId }, s.season),
    stub: { number: s.number, watchedOn: s.watchedOn, handle: s.handle },
    shortLink: s.profileUrl,
  };
}

export async function titleCardProps(t: CardSource, host: string): Promise<CardProps> {
  return { title: await cardTitle(t, null), stub: null, shortLink: host };
}

export async function renderCard(
  el: ReactElement,
  format: keyof typeof CARD_SIZE,
  headers: Record<string, string>,
): Promise<ImageResponse> {
  const fonts = await loadOgFonts();
  return new ImageResponse(el, { ...CARD_SIZE[format], fonts, headers });
}

/** "stubbed.app" from NEXT_PUBLIC_SITE_URL (localhost in dev). */
export function siteHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').host;
  } catch {
    return 'localhost';
  }
}
