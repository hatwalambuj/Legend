/** TitleKey helpers. OWNER: Architect. FROZEN. */
import type { MediaType, TitleKey } from './types';

export function toTitleKey(mediaType: MediaType, tmdbId: number): TitleKey {
  return `${mediaType}:${tmdbId}`;
}

const KEY_RE = /^(movie|tv):([1-9]\d{0,9})$/;

export function parseTitleKey(key: string): { mediaType: MediaType; tmdbId: number } | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return { mediaType: m[1] as MediaType, tmdbId: Number(m[2]) };
}

export function isTitleKey(key: string): key is TitleKey {
  return KEY_RE.test(key);
}
