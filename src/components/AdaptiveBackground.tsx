'use client';
/**
 * Poster-adaptive background (DESIGN §4.1, ADR-007). SSR'd with the page's palette so the first paint
 * is tinted; on browse screens it follows the hovered / focused ticket (140 ms debounce) and, on touch,
 * the rail card nearest the left snap edge once scrolling settles (120 ms). Two layers cross-fade.
 * Layers: tint gradients → blurred LQIP → scrim (≥ .60) → grain. The client never computes colours.
 */
import { useEffect, useRef, useState } from 'react';
import type { Palette } from '@/lib/types';
import styles from './AdaptiveBackground.module.css';

interface Tint {
  tint1: string;
  tint2: string;
  lqip: string | null;
}

function fromPalette(p: Palette): Tint {
  return { tint1: p.tint1, tint2: p.tint2, lqip: p.lqip };
}

function fromEl(el: HTMLElement): Tint | null {
  const tint1 = el.dataset.tint1;
  const tint2 = el.dataset.tint2;
  if (!tint1 || !tint2) return null;
  return { tint1, tint2, lqip: el.dataset.lqip || null };
}

function Layer({ tint, on }: { tint: Tint; on: boolean }) {
  return (
    <div className={`${styles.layer} ${on ? styles.on : ''}`}>
      <div
        className={styles.tint}
        style={{ ['--t1' as string]: tint.tint1, ['--t2' as string]: tint.tint2 }}
      />
      {tint.lqip && (
        <div className={styles.poster} style={{ backgroundImage: `url("${tint.lqip}")` }} />
      )}
    </div>
  );
}

export function AdaptiveBackground({
  palette,
  follow = false,
}: {
  palette: Palette;
  /** Follow hovered/focused tickets (home, browse, search). */
  follow?: boolean;
}) {
  const [layers, setLayers] = useState<{ a: Tint; b: Tint; front: 'a' | 'b' }>(() => ({
    a: fromPalette(palette),
    b: fromPalette(palette),
    front: 'a',
  }));
  const current = useRef<string>(palette.tint1 + palette.tint2);

  const show = useRef((t: Tint) => {
    const id = t.tint1 + t.tint2;
    if (id === current.current) return;
    current.current = id;
    setLayers((l) => {
      const back = l.front === 'a' ? 'b' : 'a';
      return { ...l, [back]: t, front: back };
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', t.tint2);
  });

  // Client navigation between two titles reuses this instance: cross-fade to the new palette.
  useEffect(() => {
    show.current({ tint1: palette.tint1, tint2: palette.tint2, lqip: palette.lqip });
  }, [palette.tint1, palette.tint2, palette.lqip]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && palette.tint1.length !== 7)
      console.warn('[AdaptiveBackground] palette looks unclamped', palette);
  }, [palette]);

  useEffect(() => {
    if (!follow) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tint1]');
      if (!el) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const t = fromEl(el);
        if (t) show.current(t);
      }, 140);
    };
    const onFocus = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tint1]');
      const t = el && fromEl(el);
      if (t) show.current(t);
    };
    const onScroll = (e: Event) => {
      const rail = e.target as HTMLElement;
      if (!(rail instanceof HTMLElement) || !rail.hasAttribute('data-rail')) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const r = rail.getBoundingClientRect();
        let best: HTMLElement | null = null;
        let bd = Infinity;
        rail.querySelectorAll<HTMLElement>('[data-tint1]').forEach((c) => {
          const d = Math.abs(c.getBoundingClientRect().left - r.left - 16);
          if (d < bd) {
            bd = d;
            best = c;
          }
        });
        const t = best && fromEl(best);
        if (t) show.current(t);
      }, 120);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      clearTimeout(scrollTimer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [follow]);

  return (
    <div className={styles.bg} aria-hidden="true" data-testid="adaptive-bg">
      <Layer tint={layers.a} on={layers.front === 'a'} />
      <Layer tint={layers.b} on={layers.front === 'b'} />
      <div className={styles.scrim} />
      <div className={styles.grain} />
    </div>
  );
}
