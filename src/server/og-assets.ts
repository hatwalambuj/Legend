/**
 * Assets of the OG / story image routes (ADR-013 C-08). FE owns the JSX (src/og/*.tsx); this module
 * owns the data they need from disk or the network.
 * - Fonts: next/og takes ttf/otf/woff only (our src/app/fonts are woff2), so we ship Geist Regular
 *   (OFL, copied from next/dist/compiled/@vercel/og) and, when present, an optional
 *   BricolageGrotesque-Bold.ttf display face. Read once per process.
 * - Poster: demo or `images: 'off'` → null with no request. Live → TMDB w500 with a 1.5 s timeout and a
 *   1.5 MB cap; any failure → null (the card falls back to the palette gradient).
 * OWNER: Backend.
 */
import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TMDB_IMAGE_BASE } from '@/lib/images';
import type { AppMode } from '@/lib/types';

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: 'normal';
}

export const OG_FONT_DIR = join('src', 'og', 'fonts');
export const POSTER_TIMEOUT_MS = 1500;
export const POSTER_MAX_BYTES = 1.5 * 1024 * 1024;
const POSTER_PATH_RE = /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;

const toArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

let fonts: Promise<OgFont[]> | null = null;

async function readFonts(root: string): Promise<OgFont[]> {
  const out: OgFont[] = [
    {
      name: 'Geist',
      data: toArrayBuffer(await readFile(join(root, OG_FONT_DIR, 'Geist-Regular.ttf'))),
      weight: 400,
      style: 'normal',
    },
  ];
  try {
    const display = await readFile(join(root, OG_FONT_DIR, 'BricolageGrotesque-Bold.ttf'));
    out.push({
      name: 'Bricolage Grotesque',
      data: toArrayBuffer(display),
      weight: 700,
      style: 'normal',
    });
  } catch {
    /* optional display face: Geist is used at display sizes */
  }
  return out;
}

/** The fonts for `ImageResponse({ fonts })`. Cached per process; a failed read is retried next call. */
export function loadOgFonts(root: string = process.cwd()): Promise<OgFont[]> {
  fonts ??= readFonts(root).catch((e: unknown) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

/** Tests only. */
export function resetOgFonts(): void {
  fonts = null;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Poster as a data URL for satori, or null (→ palette fallback). Never throws; never fetches in demo
 * mode or with images off. Only the TMDB poster CDN we already use is read (ADR-013 §0).
 */
export async function loadPosterDataUrl(
  posterPath: string | null,
  mode: Pick<AppMode, 'images' | 'isDemo'>,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (mode.isDemo || mode.images !== 'tmdb' || !posterPath || !POSTER_PATH_RE.test(posterPath))
    return null;
  try {
    const res = await fetchImpl(`${TMDB_IMAGE_BASE}/w500${posterPath}`, {
      signal: AbortSignal.timeout(POSTER_TIMEOUT_MS),
      cache: 'force-cache',
    });
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > POSTER_MAX_BYTES) return null;
    const bytes = await readCapped(res, POSTER_MAX_BYTES);
    return bytes ? `data:${type};base64,${Buffer.from(bytes).toString('base64')}` : null;
  } catch {
    return null;
  }
}
