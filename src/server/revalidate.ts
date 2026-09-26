/**
 * Cache tags + best-effort revalidation after writes (SYSTEM_DESIGN §4.5). Pages are dynamic SSR today
 * (ADR-001), so these only matter for data caches that opt into the tags; a failure never fails a write.
 * OWNER: Backend.
 */
import 'server-only';
import { revalidateTag } from 'next/cache';
import type { TitleKey } from '@/lib/types';

export const TAGS = {
  catalog: 'catalog',
  /** TMDB detail data cache (L1). */
  title: (key: TitleKey) => `title:${key}`,
  /** Stubbed reviews + community stats of a title. */
  titleReviews: (key: TitleKey) => `title:${key}:reviews`,
  /** Public profile, wallet, diary and reviews of a user. */
  user: (handle: string) => `user:${handle}`,
} as const;

export function revalidateAfterWrite(tags: string[]): void {
  for (const t of tags) {
    try {
      revalidateTag(t, { expire: 0 });
    } catch (e) {
      // Outside a request scope (unit tests, scripts) there is nothing to revalidate.
      if (process.env.NODE_ENV !== 'test') console.warn('[revalidate] skipped', t, e);
    }
  }
}
