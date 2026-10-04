/**
 * Share ticket images (ADR-013 C-08). Base: docs/02-design/share/ShareCard.base.tsx (arena winner C1
 * "Literal ticket", spec base-design.md) with the SYNTHESIS.md grafts:
 *  1. rewatch (stub #>=2): big numeral headline above the ticket ("3×" + "THIRD WATCH · @handle");
 *  2. story safe frame: every element sits inside y 250…1580;
 *  3. tiered title sizes (<=14 / <=28 / longer chars) with a 2-line clamp + ellipsis;
 *  5. the short link sits inside the safe frame, above the reply-bar zone.
 * Graft 4 (review quotes) is not used: no route shares review text (ADR-013 C-08 privacy rule).
 * Satori subset only: flexbox + absolute positioning, inline styles, every multi-child <div> sets
 * display:flex, no fetch at render (the poster arrives as a data URI or null → palette fallback).
 * The TMDB credit is always printed (ADR-013 C-08 AC3); the IMDb chip only when the rating is known.
 * OWNER: Frontend.
 */
import type { ReactElement } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { formatScore } from '@/lib/format';
import { clampY } from '@/lib/palette';

export interface CardTitle {
  name: string;
  year: number;
  type: 'movie' | 'tv';
  /** Movie: null (prints ADMIT ONE + serial). TV: "S03" (season stub) or "S01–S04". */
  seasonsLabel: string | null;
  tmdbScore: number;
  /** null hides the chip entirely (ADR-008). */
  imdbScore: number | null;
  /** Pre-fetched poster as a data URI; null → palette fallback. */
  posterDataUri: string | null;
  palette: { vibrant: string; tint1: string; tint2: string } | null;
  /** Decorative serial (DESIGN §3.1). */
  serial: string;
}

export interface CardStub {
  /** 1 = first watch, 2+ = rewatch. */
  number: number;
  watchedOn: string | null;
  handle: string;
}

export interface CardProps {
  title: CardTitle;
  /** null → the title card (no stub: "ADMIT ONE" + "Stub it"). */
  stub: CardStub | null;
  /** Printed link, e.g. "stubbed.app/u/maya". */
  shortLink: string;
}

const T = {
  bg: '#0B0B0D',
  fg: '#F4F1EA',
  fg2: '#BDB8AE',
  paper: '#EFE9DE',
  paper2: '#E3DCCD',
  paper3: '#D6CEBD',
  ink: '#141210',
  ink2: '#5E584F',
  perf: 'rgba(20,18,16,.26)',
  accent: '#FF5B3A',
  stamp: '#B02E17',
  imdb: '#F5C518',
} as const;
// Only Geist ships today (src/og/fonts); Satori falls back to it when the display face is absent.
const DISPLAY = 'Bricolage Grotesque';
const UI = 'Geist';
const NEUTRAL = { vibrant: '#3a3a46', tint1: '#2a2a33', tint2: '#101014' };
const BRAND_UPPER = BRAND_NAME.toUpperCase();

export const CARD_SIZE = {
  story: { width: 1080, height: 1920 },
  og: { width: 1200, height: 630 },
} as const;
/** SYNTHESIS graft 2: IG/TikTok UI covers the top 250 and bottom 340 px of a story. */
export const STORY_SAFE = { top: 250, bottom: 1580 } as const;

/* ---------- pure helpers (unit-tested) ---------- */

/**
 * next/og fetches a Google font for any glyph our fonts lack (a third-party request at render time).
 * Keep image text to Latin + the few marks we print; anything else is dropped. Empty → fallback.
 */
const OG_TEXT_DROP = /[^\u0020-\u007E\u00A0-\u024F\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/gu;
export function ogText(raw: string, fallback = 'Untitled'): string {
  const s = raw.normalize('NFC').replace(OG_TEXT_DROP, '').replace(/\s+/g, ' ').trim();
  return s || fallback;
}

/** Graft 3: font size by title length; longer titles clamp to 2 lines with an ellipsis. */
export function titleTier(name: string, sizes: [number, number, number] = [56, 46, 38]) {
  const s = name.replace(/\s+/g, ' ').trim();
  const size = s.length <= 14 ? sizes[0] : s.length <= 28 ? sizes[1] : sizes[2];
  const max = 52; // ~2 lines at the smallest tier
  const text = s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
  return { size, text };
}

const ORD = ['', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH'];
/** Graft 1 line: "THIRD WATCH · @maya" (11+ → "11TH WATCH"). */
export function watchLine(n: number, handle: string): string {
  const sfx = n % 100 >= 11 && n % 100 <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
  return `${ORD[n] ?? `${n}${sfx}`} WATCH · @${handle}`;
}

export function watchedLabel(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return 'DATE NOT LOGGED';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const m = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[d.getUTCMonth()];
  return `WATCHED ${String(d.getUTCDate()).padStart(2, '0')} ${m} ${d.getUTCFullYear()}`;
}

export function creditLine(hasPoster: boolean): string {
  return hasPoster ? 'POSTER + DATA: TMDB' : 'DATA: TMDB';
}

function tints(p: CardTitle['palette']) {
  const src = p ?? NEUTRAL;
  // Defensive re-clamp: an unclamped palette must never reach a share image (DESIGN §4.4).
  return { vibrant: src.vibrant, t1: clampY(src.tint1, 0.06), t2: clampY(src.tint2, 0.02) };
}

function ground(p: CardTitle['palette']) {
  const { t1, t2 } = tints(p);
  return [
    'linear-gradient(180deg, rgba(11,11,13,.35) 0%, rgba(11,11,13,.55) 60%, rgba(11,11,13,.80) 100%)',
    `radial-gradient(55% 45% at 18% 8%, ${t1}, transparent 70%)`,
    `radial-gradient(50% 55% at 88% 22%, ${t2}, transparent 72%)`,
    `linear-gradient(180deg, ${t2}, ${T.bg} 78%)`,
  ].join(', ');
}

/* ---------- ticket silhouettes (inline SVG data URIs: true transparent notches) ---------- */

const svgUri = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

export function verticalTicketPath(W: number, H: number, perfY: number, r = 28, n = 28): string {
  const tooth = 20;
  const depth = 16;
  let d = `M${r},0 H${W - r} A${r},${r} 0 0 1 ${W},${r} V${perfY - n} A${n},${n} 0 0 0 ${W},${perfY + n} V${H - depth}`;
  const teeth = Math.round(W / tooth);
  const step = W / teeth;
  for (let i = 1; i <= teeth; i++) {
    const x = W - i * step;
    d += ` L${(x + step / 2).toFixed(1)},${H} L${x.toFixed(1)},${H - depth}`;
  }
  return `${d} V${perfY + n} A${n},${n} 0 0 0 0,${perfY - n} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
}

export function horizontalTicketPath(W: number, H: number, perfX: number, r = 24, n = 24): string {
  const tooth = 20;
  const depth = 14;
  let d = `M${r},0 H${perfX - n} A${n},${n} 0 0 0 ${perfX + n},0 H${W - depth}`;
  const teeth = Math.round(H / tooth);
  const step = H / teeth;
  for (let i = 1; i <= teeth; i++) {
    const y = i * step;
    d += ` L${W},${(y - step / 2).toFixed(1)} L${W - depth},${y.toFixed(1)}`;
  }
  return `${d} H${perfX + n} A${n},${n} 0 0 0 ${perfX - n},${H} H${r} A${r},${r} 0 0 1 0,${H - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
}

function ticketSvg(o: {
  W: number;
  H: number;
  path: string;
  fill: string;
  M: number;
  perf?: { x1: number; y1: number; x2: number; y2: number };
  shadow?: boolean;
}): string {
  const f = o.shadow
    ? '<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="36" stdDeviation="28" flood-color="#000" flood-opacity=".5"/><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity=".35"/></filter>'
    : '';
  const line = o.perf
    ? `<line x1="${o.perf.x1}" y1="${o.perf.y1}" x2="${o.perf.x2}" y2="${o.perf.y2}" stroke="${T.perf}" stroke-width="3" stroke-dasharray="14 10"/>`
    : '';
  const { W, H, M } = o;
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 2 * M}" height="${H + 2 * M}" viewBox="${-M} ${-M} ${W + 2 * M} ${H + 2 * M}">${f}<path d="${o.path}" fill="${o.fill}"${o.shadow ? ' filter="url(#s)"' : ''}/>${line}</svg>`,
  );
}

/* ---------- parts ---------- */

const mono = (size: number, color: string, extra: object = {}) => ({
  fontFamily: UI,
  fontSize: size,
  letterSpacing: size * 0.14,
  color,
  textTransform: 'uppercase' as const,
  ...extra,
});

function Wordmark({ size, color = T.fg }: { size: number; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        fontFamily: DISPLAY,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: -size * 0.035,
        color,
        lineHeight: 1,
      }}
    >
      <span>{BRAND_NAME}</span>
      <div
        style={{
          width: size * 0.2,
          height: size * 0.2,
          borderRadius: 999,
          background: T.accent,
          marginLeft: size * 0.06,
          marginBottom: size * 0.12,
        }}
      />
    </div>
  );
}

function Stamp({ n, size }: { n: number; size: number }) {
  return (
    <div
      style={{
        display: 'flex',
        padding: `${size * 0.33}px ${size * 0.53}px`,
        border: `${Math.round(size * 0.13)}px solid ${T.stamp}`,
        borderRadius: size * 0.27,
        background: T.paper,
        color: T.stamp,
        fontFamily: UI,
        fontSize: size,
        letterSpacing: size * 0.1,
        lineHeight: 1,
        transform: 'rotate(4deg)',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
      }}
    >{`${n}× ${BRAND_UPPER}`}</div>
  );
}

function Score({ tmdb, imdb, size }: { tmdb: number; imdb: number | null; size: number }) {
  const h = size * 0.45;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: size * 0.32 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: size * 0.08 }}>
        <span
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: size,
            lineHeight: 0.9,
            letterSpacing: -size * 0.04,
            color: T.ink,
          }}
        >
          {formatScore(tmdb)}
        </span>
        <span style={mono(size * 0.23, T.ink2, { marginBottom: size * 0.08, letterSpacing: 1 })}>
          TMDB
        </span>
      </div>
      {imdb != null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: h * 0.3, marginBottom: size * 0.04 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: h,
              padding: `0 ${h * 0.25}px`,
              borderRadius: h * 0.15,
              background: T.imdb,
              color: '#000',
              fontFamily: UI,
              fontSize: h * 0.55,
            }}
          >
            IMDb
          </div>
          <span style={{ fontFamily: UI, fontSize: h * 0.75, color: T.ink }}>{formatScore(imdb)}</span>
        </div>
      ) : null}
    </div>
  );
}

function Art({ t, w, h, kicker, titleSize }: { t: CardTitle; w: number; h: number; kicker: number; titleSize: number }) {
  const { vibrant, t1, t2 } = tints(t.palette);
  const tier = titleTier(t.name, [titleSize, titleSize * 0.8, titleSize * 0.66]);
  return (
    <div style={{ display: 'flex', position: 'relative', width: w, height: h, borderRadius: 14, overflow: 'hidden', background: t2 }}>
      {t.posterDataUri ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image layer
        <img src={t.posterDataUri} width={w} height={h} style={{ width: w, height: h, objectFit: 'cover', objectPosition: 'top' }} />
      ) : (
        // Fallback poster: palette + title type (DESIGN §3.3); it must always render.
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: w,
            height: h,
            padding: titleSize * 0.5,
            backgroundImage: `radial-gradient(70% 50% at 30% 10%, ${vibrant}59, transparent 70%), linear-gradient(160deg, ${t1}, ${t2})`,
          }}
        >
          <span style={mono(kicker, 'rgba(255,255,255,.72)', { alignSelf: 'center', marginTop: titleSize * 0.6 })}>
            {`N° ${t.serial}`}
          </span>
          <span
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: tier.size,
              lineHeight: 0.95,
              letterSpacing: -tier.size * 0.04,
              color: '#fff',
              textTransform: 'uppercase',
            }}
          >
            {tier.text}
          </span>
        </div>
      )}
    </div>
  );
}

function TypePill({ type, size }: { type: 'movie' | 'tv'; size: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: size * 2.2,
        padding: `0 ${size * 0.8}px`,
        borderRadius: 999,
        background: 'rgba(0,0,0,.55)',
        border: '1px solid rgba(255,255,255,.18)',
        ...mono(size, T.fg, { letterSpacing: size * 0.1 }),
      }}
    >
      {type === 'tv' ? 'SHOW' : 'MOVIE'}
    </div>
  );
}

const printLeft = (t: CardTitle) => t.seasonsLabel ?? `ADMIT ONE  N° ${t.serial}`;
const metaOf = (t: CardTitle) => [t.year > 0 ? String(t.year) : '', t.type === 'tv' ? 'SHOW' : 'MOVIE'].filter(Boolean);

/* ---------- story 1080 × 1920 (stub share) ---------- */

export function StoryCard({ title: t, stub, shortLink }: CardProps & { stub: CardStub }): ReactElement {
  const W = 760;
  const M = 80;
  const X = 160;
  const rewatch = stub.number >= 2;
  // Safe frame: wordmark row at 250, rewatch headline 320–450, ticket bottom at 1480, link ≤ 1580.
  const Y = rewatch ? 470 : 330;
  const H = 1480 - Y;
  const BODY = 360;
  const perfY = H - BODY;
  const artH = perfY - 40;
  const path = verticalTicketPath(W, H, perfY);
  const tier = titleTier(t.name);
  const eyebrow = rewatch ? 'REWATCHED' : 'JUST STUBBED';
  const layers = [
    stub.number >= 3 ? { fill: T.paper3, dx: -12, dy: 30, rot: -1.8 } : null,
    rewatch ? { fill: T.paper2, dx: 14, dy: 16, rot: 1.6 } : null,
  ].filter((l): l is NonNullable<typeof l> => l !== null);

  return (
    <div style={{ display: 'flex', position: 'relative', width: 1080, height: 1920, background: T.bg, backgroundImage: ground(t.palette), fontFamily: UI }}>
      <div style={{ display: 'flex', position: 'absolute', left: 80, right: 80, top: STORY_SAFE.top, justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark size={40} />
        <span style={mono(20, T.fg2)}>{eyebrow}</span>
      </div>

      {rewatch ? (
        <div style={{ display: 'flex', position: 'absolute', left: 80, right: 80, top: 316, alignItems: 'flex-end', gap: 24 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 132, lineHeight: 0.9, letterSpacing: -5, color: T.fg }}>
            {`${stub.number}×`}
          </span>
          <span style={mono(24, T.fg, { marginBottom: 14 })}>{watchLine(stub.number, stub.handle)}</span>
        </div>
      ) : null}

      {layers.map((l) => (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image layer
        <img
          key={l.fill}
          src={ticketSvg({ W, H, path, fill: l.fill, M })}
          width={W + 2 * M}
          height={H + 2 * M}
          style={{ position: 'absolute', left: X - M + l.dx, top: Y - M + l.dy, transform: `rotate(${l.rot}deg)` }}
        />
      ))}
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image layer */}
      <img
        src={ticketSvg({ W, H, path, fill: T.paper, M, shadow: true, perf: { x1: 40, y1: perfY, x2: W - 40, y2: perfY } })}
        width={W + 2 * M}
        height={H + 2 * M}
        style={{ position: 'absolute', left: X - M, top: Y - M }}
      />

      <div style={{ display: 'flex', position: 'absolute', left: X + 20, top: Y + 20 }}>
        <Art t={t} w={720} h={artH} kicker={20} titleSize={96} />
        <div style={{ display: 'flex', position: 'absolute', left: 24, top: 24 }}>
          <TypePill type={t.type} size={20} />
        </div>
        <div style={{ display: 'flex', position: 'absolute', right: 24, top: 28 }}>
          <Stamp n={stub.number} size={30} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: X + 40, width: W - 80, top: Y + perfY + 26, height: BODY - 26 - 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={mono(20, T.ink2)}>{printLeft(t)}</span>
          <span style={mono(20, rewatch ? T.stamp : T.ink)}>{`STUB #${stub.number}`}</span>
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 10,
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: tier.size,
            lineHeight: 1.08,
            letterSpacing: -tier.size * 0.035,
            color: T.ink,
            maxHeight: tier.size * 1.08 * 2,
            overflow: 'hidden',
          }}
        >
          {tier.text}
        </div>
        <div style={{ display: 'flex', flexGrow: 1, justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Score tmdb={t.tmdbScore} imdb={t.imdbScore} size={80} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            {metaOf(t).map((m) => (
              <span key={m} style={mono(22, T.ink2, { letterSpacing: 2, lineHeight: 1.35 })}>
                {m}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20 }}>
          <span style={{ fontFamily: UI, fontSize: 24, color: T.ink }}>{`@${stub.handle}`}</span>
          <span style={mono(20, T.ink2)}>{watchedLabel(stub.watchedOn)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', position: 'absolute', left: 0, right: 0, top: 1504, justifyContent: 'center', ...mono(18, T.fg2, { letterSpacing: 2 }) }}>
        {creditLine(Boolean(t.posterDataUri))}
      </div>
      <div style={{ display: 'flex', position: 'absolute', left: 0, right: 0, top: 1536, justifyContent: 'center', fontFamily: UI, fontSize: 30, color: T.fg }}>
        {shortLink}
      </div>
    </div>
  );
}

/* ---------- og 1200 × 630 (stub share, or the title card when stub is null) ---------- */

export function OgCard({ title: t, stub, shortLink }: CardProps): ReactElement {
  const W = 1080;
  const H = 500;
  const M = 60;
  const X = 60;
  const Y = 44;
  const perfX = 800;
  const path = horizontalTicketPath(W, H, perfX);
  const rewatch = (stub?.number ?? 1) >= 2;
  const tier = titleTier(t.name, [64, 56, 46]);

  return (
    <div style={{ display: 'flex', position: 'relative', width: 1200, height: 630, background: T.bg, backgroundImage: ground(t.palette), fontFamily: UI }}>
      {rewatch ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image layer
        <img
          src={ticketSvg({ W, H, path, fill: T.paper2, M })}
          width={W + 2 * M}
          height={H + 2 * M}
          style={{ position: 'absolute', left: X - M, top: Y - M + 10, transform: 'rotate(0.8deg)' }}
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image layer */}
      <img
        src={ticketSvg({ W, H, path, fill: T.paper, M, shadow: true, perf: { x1: perfX, y1: 36, x2: perfX, y2: H - 36 } })}
        width={W + 2 * M}
        height={H + 2 * M}
        style={{ position: 'absolute', left: X - M, top: Y - M }}
      />

      <div style={{ display: 'flex', position: 'absolute', left: X + 20, top: Y + 20 }}>
        <Art t={t} w={300} h={460} kicker={12} titleSize={44} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: X + 352, width: perfX - 352 - 32, top: Y + 40, height: H - 76 }}>
        <span style={mono(18, T.ink2)}>{printLeft(t)}</span>
        <div
          style={{
            display: 'flex',
            marginTop: 14,
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: tier.size,
            letterSpacing: -tier.size * 0.035,
            color: T.ink,
            lineHeight: 1.05,
            maxHeight: tier.size * 2.1,
            overflow: 'hidden',
          }}
        >
          {tier.text}
        </div>
        <span style={mono(20, T.ink2, { marginTop: 14, letterSpacing: 2 })}>{metaOf(t).join(' · ')}</span>
        <div style={{ display: 'flex', marginTop: 'auto', alignItems: 'center' }}>
          <Score tmdb={t.tmdbScore} imdb={t.imdbScore} size={72} />
        </div>
        <div style={{ display: 'flex', marginTop: 22, alignItems: 'baseline', gap: 12 }}>
          {stub ? <span style={{ fontFamily: UI, fontSize: 24, color: T.ink }}>{`@${stub.handle}`}</span> : null}
          <span style={mono(18, T.ink2)}>{stub ? watchedLabel(stub.watchedOn) : 'RATED 6.5+ ON TMDB'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', position: 'absolute', left: X + perfX + 24, width: W - perfX - 24 - 34, top: Y + 36, height: H - 72 }}>
        {stub ? <Stamp n={stub.number} size={20} /> : <span style={mono(18, T.ink2)}>ADMIT ONE</span>}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={mono(20, T.ink2)}>{stub ? 'STUB' : 'RATED'}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 96, lineHeight: 1, letterSpacing: -4, color: rewatch ? T.stamp : T.ink }}>
            {stub ? `#${stub.number}` : '6.5+'}
          </span>
          <span style={mono(16, T.ink2, { marginTop: 8 })}>{t.seasonsLabel ?? `N° ${t.serial}`}</span>
        </div>
        <Wordmark size={30} color={T.ink} />
      </div>

      <span style={{ position: 'absolute', left: 60, top: 584, ...mono(16, T.fg2, { letterSpacing: 2 }) }}>
        {creditLine(Boolean(t.posterDataUri))}
      </span>
      <span style={{ position: 'absolute', right: 60, top: 580, fontFamily: UI, fontSize: 20, color: T.fg }}>{shortLink}</span>
    </div>
  );
}
