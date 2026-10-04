'use client';
/**
 * `worth_it_viewed` (ADR-013 C-09): fires once per page view when the slip is ≥ 50 % visible for 1 s.
 * A hidden sentinel inside the slip observes its parent, so the server-rendered slip stays a server
 * component. No IntersectionObserver (old browsers, jsdom) → nothing is sent.
 */
import { useEffect, useRef } from 'react';
import { trackEvent } from '@/lib/analytics';
import type { VerdictKey } from '@/lib/types';

export const SEEN_RATIO = 0.5;
export const SEEN_MS = 1000;

export function WorthItSeen({ verdict }: { verdict: VerdictKey }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (done || !entry) return;
        if (entry.intersectionRatio >= SEEN_RATIO) {
          timer ??= setTimeout(() => {
            done = true;
            trackEvent('worth_it_viewed', { verdict });
            io.disconnect();
          }, SEEN_MS);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, SEEN_RATIO] },
    );
    io.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      io.disconnect();
    };
  }, [verdict]);
  return <span ref={ref} hidden />;
}
