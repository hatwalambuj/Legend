/**
 * Stubbed share ticket (C-08), candidate 1 "Literal ticket".
 * Spec: ./design.md. Satori-safe: flexbox only, inline styles, no grid, no fetch at render.
 * Every <div> with more than one child sets display:flex, as Satori requires.
 * The poster must arrive as a data URI (pre-fetched by the route), or null for the fallback.
 */
import { ImageResponse } from 'next/og';
import type { ReactElement, ReactNode } from 'react';
import { clampY } from '@/lib/palette';

// ---------- props ----------

export type ShareFormat = 'story' | 'og';

export interface ShareTitle {
  name: string;
  year: number | null;
  type: 'movie' | 'tv';
  /** e.g. "2H 46M" (movie) or "2 SEASONS" (tv); null to omit. */
  lengthLabel: string | null;
  /** Movie: null (prints ADMIT ONE). TV: "S01–S04", or "S2 · E5" for an episode stub. */
  seasonsLabel: string | null;
  tmdbScore: number; // 0–10, always present for listed titles
  imdbScore: number | null; // null hides the chip entirely
  /** Pre-fetched TMDB w780 poster as a data URI. null means palette fallback (and no TMDB credit). */
  posterDataUri: string | null;
  /** From titles.palette; null means genre default. */
  palette: { vibrant: string; tint1: string; tint2: string } | null;
  /** Decorative serial, deterministic from the title id (DESIGN §3.1). */
  serial: string; // "01200"
}

export interface ShareStub {
  /** Which watch this is: 1 = first, 2+ = rewatch. Printed as "STUB #N". */
  number: number;
  /** ISO date or null (imports without a date). */
  watchedOn: string | null;
  /** null when the user hides their handle. */
  handle: string | null;
}

/**
 * The review body is deliberately absent from this type. The caller passes
 * `quote: review.spoiler ? null : review.body`, and spoiler text cannot be expressed here.
 */
export interface ShareReview {
  rating10: number | null; // 1–10 (half stars), null = text-only review
  quote: string | null; // raw body (we truncate); null if no text OR spoiler
  spoiler: boolean;
}

export interface ShareCardProps {
  title: ShareTitle;
  stub: ShareStub;
  review?: ShareReview; // present means review share
  shortLink: string; // "stubbed.app/s/k3x9q"
}

// ---------- tokens (DESIGN §2.1) ----------

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
const DISPLAY = 'Bricolage Grotesque';
const UI = 'Geist';
const MONO = 'Geist Mono';
const NEUTRAL = { vibrant: '#3a3a46', tint1: '#2a2a33', tint2: '#101014' };

// ---------- pure helpers (exported for unit tests) ----------

export function truncateQuote(raw: string | null, max = 140): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return (at > 60 ? cut.slice(0, at) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

export function storyTitleSize(name: string): { size: number; text: string } {
  const n = name.length;
  if (n <= 16) return { size: 56, text: name };
  if (n <= 24) return { size: 46, text: name };
  if (n <= 32) return { size: 38, text: name };
  return { size: 38, text: name.slice(0, 31).trimEnd() + '…' };
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
  return `${n}${s}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'DATE NOT LOGGED';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  const m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `WATCHED ${String(d.getUTCDate()).padStart(2, '0')} ${m} ${d.getUTCFullYear()}`;
}

function tints(p: ShareTitle['palette']) {
  const src = p ?? NEUTRAL;
  // Defensive re-clamp: an unclamped palette must never reach a share image (DESIGN §4.4).
  return { vibrant: src.vibrant, t1: clampY(src.tint1, 0.06), t2: clampY(src.tint2, 0.02) };
}

function ground(p: ShareTitle['palette']) {
  const { t1, t2 } = tints(p);
  return [
    'linear-gradient(180deg, rgba(11,11,13,.35) 0%, rgba(11,11,13,.55) 60%, rgba(11,11,13,.80) 100%)',
    `radial-gradient(55% 45% at 18% 8%, ${t1}, transparent 70%)`,
    `radial-gradient(50% 55% at 88% 22%, ${t2}, transparent 72%)`,
    `linear-gradient(180deg, ${t2}, ${T.bg} 78%)`,
  ].join(', ');
}

// ---------- ticket silhouettes (inline SVG data URIs) ----------

const svgUri = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

/** Vertical ticket: rounded top, notches at perfY, torn bottom. M = shadow margin. */
export function verticalTicketPath(W: number, H: number, perfY: number, r = 28, n = 28, tooth = 20, depth = 16): string {
  let d = `M${r},0 H${W - r} A${r},${r} 0 0 1 ${W},${r} V${perfY - n} A${n},${n} 0 0 0 ${W},${perfY + n} V${H - depth}`;
  const teeth = Math.round(W / tooth);
  const step = W / teeth;
  for (let i = 1; i <= teeth; i++) {
    const x = W - i * step;
    d += ` L${(x + step / 2).toFixed(1)},${H} L${x.toFixed(1)},${H - depth}`;
  }
  return d + ` V${perfY + n} A${n},${n} 0 0 0 0,${perfY - n} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
}

/** Horizontal ticket: rounded left, notches at perfX top+bottom, torn right edge. */
export function horizontalTicketPath(W: number, H: number, perfX: number, r = 24, n = 24, tooth = 20, depth = 14): string {
  let d = `M${r},0 H${perfX - n} A${n},${n} 0 0 0 ${perfX + n},0 H${W - depth}`;
  const teeth = Math.round(H / tooth);
  const step = H / teeth;
  for (let i = 1; i <= teeth; i++) {
    const y = i * step;
    d += ` L${W},${(y - step / 2).toFixed(1)} L${W - depth},${y.toFixed(1)}`;
  }
  return d + ` H${perfX + n} A${n},${n} 0 0 0 ${perfX - n},${H} H${r} A${r},${r} 0 0 1 0,${H - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
}

function ticketSvg(opts: {
  W: number; H: number; path: string; fill: string; M: number;
  perf?: { x1: number; y1: number; x2: number; y2: number }; shadow?: boolean;
}): string {
  const { W, H, path, fill, M, perf, shadow } = opts;
  const f = shadow
    ? `<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="36" stdDeviation="28" flood-color="#000" flood-opacity=".5"/><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity=".35"/></filter>`
    : '';
  const line = perf
    ? `<line x1="${perf.x1}" y1="${perf.y1}" x2="${perf.x2}" y2="${perf.y2}" stroke="${T.perf}" stroke-width="3" stroke-dasharray="14 10"/>`
    : '';
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 2 * M}" height="${H + 2 * M}" viewBox="${-M} ${-M} ${W + 2 * M} ${H + 2 * M}">${f}<path d="${path}" fill="${fill}"${shadow ? ' filter="url(#s)"' : ''}/>${line}</svg>`,
  );
}

// ---------- small parts ----------

const mono = (size: number, color: string, extra: object = {}) => ({
  fontFamily: MONO, fontWeight: 500, fontSize: size, letterSpacing: size * 0.14, color, textTransform: 'uppercase' as const, ...extra,
});

function Wordmark({ size, color = T.fg }: { size: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', fontFamily: DISPLAY, fontWeight: 800, fontSize: size, letterSpacing: -size * 0.035, color, lineHeight: 1 }}>
      <span>Stubbed</span>
      <div style={{ width: size * 0.2, height: size * 0.2, borderRadius: 999, background: T.accent, marginLeft: size * 0.06, marginBottom: size * 0.12 }} />
    </div>
  );
}

function Stamp({ n, size }: { n: number; size: number }) {
  return (
    <div style={{
      display: 'flex', padding: `${size * 0.33}px ${size * 0.53}px`, border: `${Math.round(size * 0.13)}px solid ${T.stamp}`,
      borderRadius: size * 0.27, background: T.paper, color: T.stamp, fontFamily: MONO, fontWeight: 700, fontSize: size,
      letterSpacing: size * 0.1, lineHeight: 1, transform: 'rotate(4deg)', boxShadow: '0 8px 24px rgba(0,0,0,.35)',
    }}>{`${n}× STUBBED`}</div>
  );
}

function ImdbChip({ score, h }: { score: number; h: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: h * 0.3 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: h, padding: `0 ${h * 0.25}px`, borderRadius: h * 0.15, background: T.imdb, color: '#000', fontFamily: UI, fontWeight: 600, fontSize: h * 0.55, letterSpacing: -0.5 }}>IMDb</div>
      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: h * 0.75, color: T.ink }}>{score.toFixed(1)}</span>
    </div>
  );
}

function Score({ tmdb, imdb, size }: { tmdb: number; imdb: number | null; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: size * 0.32 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: size * 0.08 }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 0.9, letterSpacing: -size * 0.04, color: T.ink }}>{tmdb.toFixed(1)}</span>
        <span style={mono(size * 0.23, T.ink2, { marginBottom: size * 0.08, letterSpacing: size * 0.02 })}>TMDB</span>
      </div>
      {imdb != null ? <div style={{ display: 'flex', marginBottom: size * 0.04 }}><ImdbChip score={imdb} h={size * 0.45} /></div> : null}
    </div>
  );
}

/** Five SVG stars (no font glyphs). rating10 is 1–10; each star is 2 points. */
function Stars({ rating10, size }: { rating10: number; size: number }) {
  const p = 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z';
  return (
    <div style={{ display: 'flex', gap: size * 0.12 }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(2, rating10 - i * 2)) / 2; // 0, .5, 1
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24">
            <defs><clipPath id={`h${i}`}><rect x="0" y="0" width={24 * fill} height="24" /></clipPath></defs>
            <path d={p} fill="none" stroke={T.stamp} strokeWidth="1.6" strokeLinejoin="round" />
            <path d={p} fill={T.stamp} clipPath={`url(#h${i})`} />
          </svg>
        );
      })}
    </div>
  );
}

function Art({ t, w, h, kickerSize, titleSize, children }: { t: ShareTitle; w: number; h: number; kickerSize: number; titleSize: number; children?: ReactNode }) {
  const { vibrant, t1, t2 } = tints(t.palette);
  return (
    <div style={{ display: 'flex', position: 'relative', width: w, height: h, borderRadius: 14, overflow: 'hidden', background: t2 }}>
      {t.posterDataUri ? (
        <img src={t.posterDataUri} width={w} height={h} style={{ width: w, height: h, objectFit: 'cover', objectPosition: 'top' }} />
      ) : (
        // Fallback poster: palette plus title type (DESIGN §3.3 "Image error / no poster").
        <div style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: w, height: h, padding: titleSize * 0.5,
          backgroundImage: `radial-gradient(70% 50% at 30% 10%, ${vibrant}59, transparent 70%), linear-gradient(160deg, ${t1}, ${t2})`,
        }}>
          <span style={mono(kickerSize, 'rgba(255,255,255,.72)', { letterSpacing: kickerSize * 0.22, alignSelf: 'center', marginTop: titleSize * 0.6 })}>{`N° ${t.serial}`}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: titleSize, lineHeight: 0.86, letterSpacing: -titleSize * 0.04, color: '#fff', textTransform: 'uppercase' }}>{t.name}</span>
        </div>
      )}
      {children}
    </div>
  );
}

function TypePill({ type, size }: { type: 'movie' | 'tv'; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: size * 2.2, padding: `0 ${size * 0.8}px`, borderRadius: 999, background: 'rgba(0,0,0,.45)', border: '1px solid rgba(255,255,255,.18)', ...mono(size, T.fg, { letterSpacing: size * 0.1 }) }}>
      {type === 'tv' ? 'SHOW' : 'MOVIE'}
    </div>
  );
}

// ---------- story 1080 × 1920 ----------

export function ShareStory({ title: t, stub, review, shortLink }: ShareCardProps): ReactElement {
  const W = 760, H = 1436, M = 80, X = 160, Y = 200;
  const isReview = !!review;
  const artH = isReview ? 900 : 1080;
  const perfY = 20 + artH + 20; // relative to ticket top
  const rewatch = stub.number >= 2;
  const path = verticalTicketPath(W, H, perfY);
  const ts = storyTitleSize(t.name);
  const quote = review && !review.spoiler ? truncateQuote(review.quote) : null;
  const printLeft = t.seasonsLabel ?? `ADMIT ONE  N° ${t.serial}`;
  const eyebrow = isReview ? 'JUST REVIEWED' : rewatch ? (stub.number >= 3 ? `REWATCHED · ${stub.number}×` : 'REWATCHED') : 'JUST STUBBED';
  const meta = [t.year?.toString(), t.type === 'tv' ? 'SHOW' : 'MOVIE', t.lengthLabel].filter(Boolean) as string[];
  const footLeft = stub.handle ? `@${stub.handle}${rewatch ? ` · ${ordinal(stub.number)} TIME` : ''}` : 'ADMIT ONE';

  return (
    <div style={{ display: 'flex', position: 'relative', width: 1080, height: 1920, background: T.bg, backgroundImage: ground(t.palette), fontFamily: UI }}>
      {/* top band */}
      <div style={{ display: 'flex', position: 'absolute', left: 80, right: 80, top: 72, justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark size={40} />
        <span style={mono(20, T.fg2)}>{eyebrow}</span>
      </div>

      {/* rewatch stack: max 2 layers behind */}
      {stub.number >= 3 ? (
        <img src={ticketSvg({ W, H, path, fill: T.paper3, M })} width={W + 2 * M} height={H + 2 * M}
          style={{ position: 'absolute', left: X - M - 12, top: Y - M + 34, transform: 'rotate(-1.8deg)' }} />
      ) : null}
      {rewatch ? (
        <img src={ticketSvg({ W, H, path, fill: T.paper2, M })} width={W + 2 * M} height={H + 2 * M}
          style={{ position: 'absolute', left: X - M + 14, top: Y - M + 18, transform: 'rotate(1.6deg)' }} />
      ) : null}

      {/* ticket paper + perforation + shadow */}
      <img src={ticketSvg({ W, H, path, fill: T.paper, M, shadow: true, perf: { x1: 40, y1: perfY, x2: W - 40, y2: perfY } })}
        width={W + 2 * M} height={H + 2 * M} style={{ position: 'absolute', left: X - M, top: Y - M }} />

      {/* art panel */}
      <div style={{ display: 'flex', position: 'absolute', left: X + 20, top: Y + 20 }}>
        <Art t={t} w={720} h={artH} kickerSize={20} titleSize={96}>
          <div style={{ display: 'flex', position: 'absolute', left: 24, top: 24 }}><TypePill type={t.type} size={20} /></div>
          <div style={{ display: 'flex', position: 'absolute', right: 24, top: 28 }}><Stamp n={stub.number} size={30} /></div>
        </Art>
      </div>

      {/* stub body */}
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: X + 40, width: W - 80, top: Y + perfY + 26, height: H - perfY - 26 - 34 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={mono(20, T.ink2)}>{printLeft}</span>
          <span style={mono(20, rewatch ? T.stamp : T.ink, { fontWeight: 700 })}>{`${isReview ? 'REVIEW · ' : ''}STUB #${stub.number}`}</span>
        </div>
        <div style={{ display: 'flex', flexShrink: 0, marginTop: 10, fontFamily: DISPLAY, fontWeight: 800, fontSize: isReview ? Math.min(ts.size, 48) : ts.size, lineHeight: 1.15, letterSpacing: -ts.size * 0.035, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ts.text}</div>

        {isReview ? (
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, marginTop: 24 }}>
            {review!.rating10 != null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <Stars rating10={review!.rating10} size={quote || review!.spoiler ? 52 : 84} />
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 28, color: T.ink }}>{`${(review!.rating10 / 2).toFixed(1)}/5`}</span>
              </div>
            ) : null}
            {review!.spoiler ? (
              <div style={{ display: 'flex', marginTop: 24, padding: '18px 20px', border: `2px dashed ${T.ink2}`, borderRadius: 10, ...mono(22, T.ink2) }}>SPOILERS INSIDE — READ IT ON STUBBED</div>
            ) : quote ? (
              <div style={{ display: 'flex', marginTop: 22, fontFamily: UI, fontWeight: 400, fontSize: 30, lineHeight: 1.38, color: T.ink }}>{`“${quote}”`}</div>
            ) : null}
            <div style={{ display: 'flex', marginTop: 'auto', ...mono(20, T.ink2, { letterSpacing: 2, textTransform: 'none' }) }}>
              {[`TMDB ${t.tmdbScore.toFixed(1)}`, t.imdbScore != null ? `IMDb ${t.imdbScore.toFixed(1)}` : null, ...meta].filter(Boolean).join(' · ')}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexGrow: 1, justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20 }}>
            <Score tmdb={t.tmdbScore} imdb={t.imdbScore} size={88} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              {meta.map((m) => <span key={m} style={mono(22, T.ink2, { letterSpacing: 22 * 0.08, lineHeight: 1.35 })}>{m}</span>)}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 22 }}>
          <span style={{ fontFamily: stub.handle ? UI : MONO, fontWeight: stub.handle ? 600 : 500, fontSize: stub.handle ? 24 : 20, color: T.ink }}>{footLeft}</span>
          <span style={mono(20, T.ink2)}>{fmtDate(stub.watchedOn)}</span>
        </div>
      </div>

      {/* credit + link */}
      {t.posterDataUri ? (
        <div style={{ display: 'flex', position: 'absolute', left: 0, right: 0, top: 1668, justifyContent: 'center', ...mono(18, T.fg2, { letterSpacing: 18 * 0.12 }) }}>POSTER: TMDB</div>
      ) : null}
      <div style={{ display: 'flex', position: 'absolute', left: 0, right: 0, top: 1756, justifyContent: 'center', fontFamily: MONO, fontWeight: 500, fontSize: 30, letterSpacing: 0.6, color: T.fg }}>{shortLink}</div>
    </div>
  );
}

// ---------- og 1200 × 630 ----------

export function ShareOg({ title: t, stub, review, shortLink }: ShareCardProps): ReactElement {
  const W = 1080, H = 500, M = 60, X = 60, Y = 44, perfX = 800;
  const path = horizontalTicketPath(W, H, perfX);
  const rewatch = stub.number >= 2;
  const titleSize = t.name.length > 28 ? 52 : 64;
  const meta = [t.year?.toString(), t.type === 'tv' ? 'SHOW' : 'MOVIE', t.lengthLabel].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', position: 'relative', width: 1200, height: 630, background: T.bg, backgroundImage: ground(t.palette), fontFamily: UI }}>
      {rewatch ? (
        <img src={ticketSvg({ W, H, path, fill: T.paper2, M })} width={W + 2 * M} height={H + 2 * M}
          style={{ position: 'absolute', left: X - M, top: Y - M + 10, transform: 'rotate(0.8deg)' }} />
      ) : null}
      <img src={ticketSvg({ W, H, path, fill: T.paper, M, shadow: true, perf: { x1: perfX, y1: 36, x2: perfX, y2: H - 36 } })}
        width={W + 2 * M} height={H + 2 * M} style={{ position: 'absolute', left: X - M, top: Y - M }} />

      <div style={{ display: 'flex', position: 'absolute', left: X + 20, top: Y + 20 }}>
        <Art t={t} w={300} h={460} kickerSize={12} titleSize={44} />
      </div>

      {/* body */}
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: X + 352, width: perfX - 352 - 32, top: Y + 40, height: H - 76 }}>
        <span style={mono(18, T.ink2)}>{t.seasonsLabel ?? `ADMIT ONE  N° ${t.serial}`}</span>
        <div style={{ display: 'flex', marginTop: 14, fontFamily: DISPLAY, fontWeight: 800, fontSize: titleSize, letterSpacing: -titleSize * 0.035, color: T.ink, lineHeight: 1.05, maxHeight: titleSize * 2.1, overflow: 'hidden' }}>{t.name}</div>
        <span style={mono(20, T.ink2, { marginTop: 14, letterSpacing: 2 })}>{meta}</span>
        <div style={{ display: 'flex', marginTop: 'auto', alignItems: 'center', gap: 16 }}>
          {review?.rating10 != null ? (
            <>
              <Stars rating10={review.rating10} size={40} />
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: T.ink }}>{`${(review.rating10 / 2).toFixed(1)}/5`}</span>
            </>
          ) : (
            <Score tmdb={t.tmdbScore} imdb={t.imdbScore} size={72} />
          )}
        </div>
        <div style={{ display: 'flex', marginTop: 22, alignItems: 'baseline', gap: 12 }}>
          {stub.handle ? <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 24, color: T.ink }}>{`@${stub.handle}`}</span> : null}
          <span style={mono(18, T.ink2)}>{fmtDate(stub.watchedOn)}</span>
        </div>
      </div>

      {/* stub */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', position: 'absolute', left: X + perfX + 24, width: W - perfX - 24 - 34, top: Y + 36, height: H - 72 }}>
        <Stamp n={stub.number} size={20} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={mono(20, T.ink2)}>{review ? 'REVIEW' : 'STUB'}</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 96, lineHeight: 1, letterSpacing: -4, color: rewatch ? T.stamp : T.ink }}>{`#${stub.number}`}</span>
          <span style={mono(16, T.ink2, { marginTop: 8 })}>{t.seasonsLabel ?? 'ADMIT ONE'}</span>
        </div>
        <Wordmark size={30} color={T.ink} />
      </div>

      {t.posterDataUri ? <span style={{ position: 'absolute', left: 60, top: 584, ...mono(16, T.fg2, { letterSpacing: 16 * 0.12 }) }}>POSTER: TMDB</span> : null}
      <span style={{ position: 'absolute', right: 60, top: 580, fontFamily: MONO, fontWeight: 500, fontSize: 20, color: T.fg }}>{shortLink}</span>
    </div>
  );
}

// ---------- rendering ----------

export type ShareFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800; style: 'normal' };

/** Node runtime only. `dir` holds static TTF instances (see design.md §8). */
export async function loadShareFonts(dir: string): Promise<ShareFont[]> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const spec: [string, ShareFont['weight'], string][] = [
    [DISPLAY, 800, 'BricolageGrotesque-ExtraBold.ttf'],
    [UI, 400, 'Geist-Regular.ttf'],
    [UI, 600, 'Geist-SemiBold.ttf'],
    [MONO, 500, 'GeistMono-Medium.ttf'],
    [MONO, 700, 'GeistMono-Bold.ttf'],
  ];
  return Promise.all(spec.map(async ([name, weight, file]) => {
    const b = await readFile(join(dir, file));
    return { name, weight, style: 'normal' as const, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
  }));
}

export const SHARE_SIZE: Record<ShareFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  og: { width: 1200, height: 630 },
};

export function renderShareImage(props: ShareCardProps, format: ShareFormat, fonts: ShareFont[]): ImageResponse {
  const el = format === 'story' ? <ShareStory {...props} /> : <ShareOg {...props} />;
  return new ImageResponse(el, {
    ...SHARE_SIZE[format],
    fonts,
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
