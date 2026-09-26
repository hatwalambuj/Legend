/**
 * Poster palette for the adaptive background (ADR-007, DESIGN §4.2): computed once at ingest by the
 * nightly job from the w92 poster, never on the hot path. `sharp` is injected (a devDependency that
 * only the job and fixture builder load). Deterministic colour maths only. OWNER: Backend.
 */
import { extractColors, tintsFrom } from '@/lib/palette';
import type { Palette } from '@/lib/types';

/** The subset of the sharp API we use (keeps the app bundle free of sharp). */
export interface SharpLike {
  (input: Buffer): {
    resize(
      w: number,
      h: number,
      o?: { fit?: 'fill' },
    ): {
      removeAlpha(): { raw(): { toBuffer(): Promise<Buffer> } };
      webp(o: { quality: number }): { toBuffer(): Promise<Buffer> };
    };
  };
}

export async function paletteFromPoster(image: Buffer, sharp: SharpLike): Promise<Palette> {
  const pixels = await sharp(image).resize(24, 36, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const { vibrant, base } = extractColors(pixels);
  const { tint1, tint2 } = tintsFrom(vibrant, base);
  const lqip = await sharp(image).resize(8, 12, { fit: 'fill' }).webp({ quality: 40 }).toBuffer();
  return {
    vibrant,
    base,
    tint1,
    tint2,
    lqip: `data:image/webp;base64,${lqip.toString('base64')}`,
    v: 1,
  };
}

/** Runs `fn` over `items` with at most `concurrency` in flight; collects per-item errors. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<{ ok: { item: T; value: R }[]; failed: { item: T; error: unknown }[] }> {
  const ok: { item: T; value: R }[] = [];
  const failed: { item: T; error: unknown }[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i]!;
      try {
        ok.push({ item, value: await fn(item) });
      } catch (error) {
        failed.push({ item, error });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker),
  );
  return { ok, failed };
}
