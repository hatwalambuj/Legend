/**
 * Share payloads for Web Share / copy link (ADR-013 C-07). Client-safe and pure. The text holds only the
 * title, year and a rating — never a review body, a stub note or spoiler content. Every URL is absolute
 * and carries `?ref=share`. OWNER: Backend (C-00).
 */
import { BRAND_NAME } from './brand';
import { profileHref, titleHref } from './routes';
import type { TitleSummary } from './types';

type ShareTitle = Pick<TitleSummary, 'mediaType' | 'tmdbId' | 'slug' | 'title' | 'year'>;

export type ShareTarget =
  | { kind: 'title'; title: ShareTitle }
  | { kind: 'wallet'; handle: string; displayName: string }
  | { kind: 'review'; title: ShareTitle; rating10: number }
  | { kind: 'stub'; stubId: string; title: ShareTitle };

export interface ShareData {
  url: string;
  title: string;
  text: string;
}

/** `/share/stub/{id}` (public landing of one stub). */
export function shareStubPath(stubId: string): string {
  return `/share/stub/${encodeURIComponent(stubId)}`;
}

function absolute(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  const url = new URL(`${base}${path}`);
  url.searchParams.set('ref', 'share');
  return url.toString();
}

const label = (t: ShareTitle) => (t.year > 0 ? `${t.title} (${t.year})` : t.title);

export function shareData(target: ShareTarget, siteUrl: string): ShareData {
  switch (target.kind) {
    case 'title':
      return {
        url: absolute(siteUrl, titleHref(target.title)),
        title: `${label(target.title)} on ${BRAND_NAME}`,
        text: `${label(target.title)} on ${BRAND_NAME}`,
      };
    case 'wallet':
      return {
        url: absolute(siteUrl, profileHref(target.handle)),
        title: `${target.displayName} on ${BRAND_NAME}`,
        text: `${target.displayName}'s ticket wallet on ${BRAND_NAME}`,
      };
    case 'review': {
      const r = Math.min(10, Math.max(1, Math.round(target.rating10)));
      return {
        url: absolute(siteUrl, titleHref(target.title)),
        title: `${label(target.title)} on ${BRAND_NAME}`,
        text: `${label(target.title)}: ${r}/10 on ${BRAND_NAME}`,
      };
    }
    case 'stub':
      return {
        url: absolute(siteUrl, shareStubPath(target.stubId)),
        title: `${label(target.title)} on ${BRAND_NAME}`,
        text: `I stubbed ${label(target.title)} on ${BRAND_NAME}`,
      };
  }
}
