/** Small pure helpers shared by both data modes. OWNER: Backend. */
import type { TitleState } from '@/lib/types';
import { STUBBED_MIN_RATINGS } from '@/lib/worth-it';

export function emptyTitleState(): TitleState {
  return {
    stubCount: 0,
    lastWatchedOn: null,
    hasStubToday: false,
    watchlisted: false,
    myReview: null,
  };
}

/** Community average on 1..10, one decimal; null until STUBBED_MIN_RATINGS ratings (PRD D6). */
export function averageOrNull(sum: number, count: number): number | null {
  return count >= STUBBED_MIN_RATINGS ? Math.round((sum / count) * 10) / 10 : null;
}
