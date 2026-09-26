/**
 * TMDB image URL builder + generated-poster fallback (ADR-006, ADR-007). OWNER: Architect. FROZEN.
 *
 * Rules
 * - Components never hard-code image.tmdb.org; they call `tmdbImage()`.
 * - When `AppMode.images === 'off'` (offline container / E2E) or the path is null, `tmdbImage()` returns
 *   null and the UI renders the generated poster (`posterFallbackStyle`) immediately.
 * - When an <img> fails to load (onError), the UI swaps to the same generated poster. Never show a
 *   broken-image icon (DESIGN §3.3).
 */
import type { AppMode, Palette } from './types';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export type PosterSize = 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original';
export type BackdropSize = 'w300' | 'w780' | 'w1280' | 'original';
export type ProfileSize = 'w45' | 'w185' | 'h632';

export function tmdbImage(
  path: string | null | undefined,
  size: PosterSize | BackdropSize | ProfileSize,
  images: AppMode['images'],
): string | null {
  if (!path || images === 'off') return null;
  return `${TMDB_IMAGE_BASE}/${size}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Grid srcset per SYSTEM_DESIGN §10.1: w185 1x / w342 2x. */
export function posterSrcSet(path: string | null, images: AppMode['images']): string | undefined {
  const a = tmdbImage(path, 'w185', images);
  const b = tmdbImage(path, 'w342', images);
  return a && b ? `${a} 185w, ${b} 342w` : undefined;
}

/** Neutral palette used when a title has none yet (DESIGN §4.3 "anything else"). */
export const NEUTRAL_PALETTE: Palette = {
  vibrant: '#5a5a6e',
  base: '#2a2a33',
  tint1: '#2a2a33',
  tint2: '#101014',
  lqip: null,
  v: 1,
};

/** Genre-default tints for titles without a palette (DESIGN §4.3). */
const GENRE_TINTS: Record<number, [string, string]> = {
  878: ['#1c2a4a', '#0b1020'], // Science Fiction
  10765: ['#1c2a4a', '#0b1020'], // Sci-Fi & Fantasy (TV)
  18: ['#3a2a2a', '#140c0c'], // Drama
  16: ['#2a3a4a', '#0c141c'], // Animation
  35: ['#4a3a1c', '#1c140a'], // Comedy
};

export function paletteOrDefault(palette: Palette | null, genreIds: number[] = []): Palette {
  if (palette) return palette;
  for (const g of genreIds) {
    const t = GENRE_TINTS[g];
    if (t) return { ...NEUTRAL_PALETTE, tint1: t[0], tint2: t[1], base: t[1], vibrant: t[0] };
  }
  return NEUTRAL_PALETTE;
}

/**
 * CSS custom properties for the adaptive background (DESIGN §4.1). Spread into a `style` prop:
 * `<div style={adaptiveBgVars(palette)}>`.
 */
export function adaptiveBgVars(palette: Palette): Record<'--tint-1' | '--tint-2', string> {
  return { '--tint-1': palette.tint1, '--tint-2': palette.tint2 };
}

/**
 * Generated poster background (the fallback for a missing/failed image): a gradient from the
 * precomputed palette. The UI sets the title text over it in Bricolage 800 plus grain.
 */
export function posterFallbackStyle(palette: Palette): {
  backgroundImage: string;
  backgroundColor: string;
} {
  return {
    backgroundColor: palette.base,
    backgroundImage: [
      `radial-gradient(120% 80% at 20% 10%, ${palette.vibrant} 0%, transparent 60%)`,
      `linear-gradient(160deg, ${palette.vibrant} 0%, ${palette.base} 55%, ${palette.tint2} 100%)`,
    ].join(', '),
  };
}
