/**
 * "Worth it?" rules (PRD §4.2, Epic F; DESIGN §7.4.1). Pure, isomorphic, deterministic — stored data +
 * rules + templates only, never AI/LLM (D15).
 * OWNER: Backend (may tune thresholds/copy; keep the exported signatures). Reference implementation and
 * tests (tests/lib/worth-it.test.ts) by Architect.
 *
 * Who calls what
 * - Backend (dal.getTitle): `buildWorthIt(input)` → TitleDetail.worthIt.
 * - Frontend (ticket stubs, any component): `ticketTimeLabel(summary)` for the stub's mono meta line (F2).
 *   Everything else arrives precomputed in `TitleDetail.worthIt`.
 */
import { BRAND_NAME } from './brand';
import type {
  PitchHook,
  SeriesStatus,
  TimeBadge,
  TimeCommitment,
  TitleEnrichment,
  TitleStats,
  TitleSummary,
  Verdict,
  VerdictKey,
  WorthIt,
} from './types';
import { vibesFor } from './vibes';

export const HOOK_MAX = 120;
export const META_MAX = 160;
export const LIKE_MAX = 6;

/* ------------------------------------------------------------------ */
/* Hook (line 1)                                                        */
/* ------------------------------------------------------------------ */

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Cut at a word boundary to <= max chars, adding "…". */
export function truncateWords(s: string, max: number): string {
  const t = clean(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/** First sentence of a text (ends at . ! ? followed by space/end), or the whole text if none. */
export function firstSentence(s: string): string {
  const t = clean(s);
  const m = /^(.+?[.!?])(?:\s|$)/.exec(t);
  return m?.[1] ?? t;
}

function joinNames(names: string[]): string {
  const n = names.filter(Boolean).slice(0, 2);
  return n.length === 2 ? `${n[0]} and ${n[1]}` : (n[0] ?? '');
}

/**
 * Priority (PRD §4.2): our hook → TMDB tagline (<= 120) → first overview sentence (cut to 120) →
 * template "A {year} {genre} {movie|series} from {director}.".
 */
export function pickHook(input: {
  title: Pick<TitleSummary, 'mediaType' | 'year' | 'genres' | 'overviewShort'>;
  pitchHook: string | null;
  tagline: string | null;
  overview?: string | null;
  directors?: string[];
}): PitchHook | null {
  const own = clean(input.pitchHook);
  if (own) return { text: truncateWords(own, HOOK_MAX), source: 'stubbed' };
  const tag = clean(input.tagline);
  if (tag && tag.length <= HOOK_MAX) return { text: tag, source: 'tmdb_tagline' };
  const ov = clean(input.overview) || clean(input.title.overviewShort);
  if (ov) return { text: truncateWords(firstSentence(ov), HOOK_MAX), source: 'tmdb_overview' };
  const genre = input.title.genres[0]?.name.toLowerCase();
  const kind = input.title.mediaType === 'movie' ? 'movie' : 'series';
  if (!input.title.year) return null;
  const base = `A ${input.title.year}${genre ? ` ${genre}` : ''} ${kind}`;
  const by = joinNames(input.directors ?? []);
  const full = by ? `${base} from ${by}.` : `${base}.`;
  return { text: full.length <= HOOK_MAX ? full : `${base}.`, source: 'template' };
}

/* ------------------------------------------------------------------ */
/* Time commitment (line 3) + ticket meta line (F2)                     */
/* ------------------------------------------------------------------ */

type Timed = Pick<
  TitleSummary,
  'mediaType' | 'year' | 'runtimeMinutes' | 'seasonCount' | 'episodeCount' | 'episodeRuntimeMinutes'
>;

const STATUS_LABEL: Record<SeriesStatus, string> = {
  returning: 'RETURNING',
  ended: 'ENDED',
  limited: 'LIMITED SERIES',
  canceled: 'CANCELED',
  in_production: 'IN PRODUCTION',
  planned: 'PLANNED',
};

const BADGE_LABEL: Record<TimeBadge, string> = {
  short_one: 'SHORT ONE',
  long_one: 'LONG ONE',
  weekend_binge: 'ONE-WEEKEND BINGE',
  big_commitment: 'BIG COMMITMENT',
};

const pos = (n: number | null | undefined): n is number => typeof n === 'number' && n > 0;

/** 166 → "2H 46M", 120 → "2H", 45 → "45M". */
export function formatRuntime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}M`;
  return m === 0 ? `${h}H` : `${h}H ${m}M`;
}

/** TV total minutes = episodes × typical episode runtime (null when either is unknown). */
export function tvTotalMinutes(t: Timed): number | null {
  return t.mediaType === 'tv' && pos(t.episodeCount) && pos(t.episodeRuntimeMinutes)
    ? t.episodeCount * t.episodeRuntimeMinutes
    : null;
}

function hoursApprox(totalMin: number, compact: boolean): string {
  if (totalMin < 60) return compact ? `≈${totalMin}M` : `≈${totalMin} MIN`;
  const h = Math.round(totalMin / 60);
  return compact ? `≈${h}H` : `≈${h} H`;
}

export function timeBadge(t: Timed): TimeBadge | null {
  if (t.mediaType === 'movie') {
    if (!pos(t.runtimeMinutes)) return null;
    if (t.runtimeMinutes < 95) return 'short_one';
    if (t.runtimeMinutes > 150) return 'long_one';
    return null;
  }
  const total = tvTotalMinutes(t);
  if (total === null) return null;
  if (total <= 8 * 60) return 'weekend_binge';
  if (total > 40 * 60) return 'big_commitment';
  return null;
}

/** Detail-page time line (DESIGN §7.4.1). null when nothing is known. */
export function timeCommitment(
  t: Timed,
  status: SeriesStatus | null = null,
): TimeCommitment | null {
  const badge = timeBadge(t);
  if (t.mediaType === 'movie') {
    if (!pos(t.runtimeMinutes)) return null;
    const h = Math.floor(t.runtimeMinutes / 60);
    const m = t.runtimeMinutes % 60;
    const spoken = [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minutes` : '']
      .filter(Boolean)
      .join(' ');
    return {
      totalMinutes: t.runtimeMinutes,
      badge,
      label: [formatRuntime(t.runtimeMinutes), badge && BADGE_LABEL[badge]]
        .filter(Boolean)
        .join(' · '),
      ariaLabel: [spoken, badge && `a ${BADGE_LABEL[badge].toLowerCase()}`]
        .filter(Boolean)
        .join(', '),
    };
  }
  const total = tvTotalMinutes(t);
  const parts: string[] = [];
  const spoken: string[] = [];
  if (pos(t.seasonCount)) {
    parts.push(`${t.seasonCount} SEASON${t.seasonCount === 1 ? '' : 'S'}`);
    spoken.push(`${t.seasonCount} season${t.seasonCount === 1 ? '' : 's'}`);
  }
  if (pos(t.episodeCount)) {
    parts.push(`${t.episodeCount} EP${t.episodeCount === 1 ? '' : 'S'}`);
    spoken.push(`${t.episodeCount} episode${t.episodeCount === 1 ? '' : 's'}`);
  }
  if (pos(t.episodeRuntimeMinutes)) {
    parts.push(`~${t.episodeRuntimeMinutes} MIN`);
    spoken.push(`about ${t.episodeRuntimeMinutes} minutes each`);
  }
  if (total !== null) {
    parts.push(hoursApprox(total, false));
    spoken.push(
      total < 60
        ? `about ${total} minutes in total`
        : `about ${Math.round(total / 60)} hours in total`,
    );
  }
  if (status) {
    parts.push(STATUS_LABEL[status]);
    spoken.push(STATUS_LABEL[status].toLowerCase());
  }
  if (badge) {
    parts.push(BADGE_LABEL[badge]);
    spoken.push(BADGE_LABEL[badge].toLowerCase());
  }
  if (parts.length === 0) return null;
  return { totalMinutes: total, badge, label: parts.join(' · '), ariaLabel: spoken.join(', ') };
}

/**
 * Ticket stub mono meta line (F2, DESIGN §7.4.1): "2024 · 2H 46M", "2022 · 4 SEASONS · ≈33H",
 * "2022 · 4 SEASONS" (episode length unknown) or just "2024" (runtime unknown).
 */
export function ticketTimeLabel(t: Timed): string {
  const parts: string[] = [String(t.year)];
  if (t.mediaType === 'movie') {
    if (pos(t.runtimeMinutes)) parts.push(formatRuntime(t.runtimeMinutes));
  } else {
    if (pos(t.seasonCount)) parts.push(`${t.seasonCount} SEASON${t.seasonCount === 1 ? '' : 'S'}`);
    const total = tvTotalMinutes(t);
    if (total !== null) parts.push(hoursApprox(total, true));
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Verdict (line 5)                                                     */
/* ------------------------------------------------------------------ */

export const VERDICT_WORDS: Record<VerdictKey, string> = {
  widely_loved: 'Widely loved',
  well_liked: 'Well liked',
  solid_pick: 'Solid pick',
  split_opinions: 'Split opinions',
  mixed_reviews: 'Mixed reviews',
};

/** Stubbed average counts only from this many ratings (PRD A8-AC1, D6). */
export const STUBBED_MIN_RATINGS = 5;

/**
 * PRD §4.2 line 5. Sources on 0–10: TMDB (always), IMDb (if known), Stubbed (if >= 5 ratings).
 * >= 2 sources and (max − min) >= 1.5 → "Split opinions". Else mean m: >= 8.0 widely loved,
 * >= 7.3 well liked, >= 6.5 solid pick, else mixed reviews. Arithmetic is done in tenths, so the
 * thresholds are exact. Never outputs a blended number.
 */
export function verdictFor(input: {
  tmdb: number;
  imdb: number | null;
  stubbedAvg: number | null;
  stubbedCount: number;
}): Verdict {
  type Src = { id: 'tmdb' | 'imdb' | 'stubbed'; name: string; verb: string; tenths: number };
  const src: Src[] = [
    { id: 'tmdb', name: 'TMDB', verb: 'rates', tenths: Math.round(input.tmdb * 10) },
  ];
  if (input.imdb !== null && input.imdb > 0)
    src.push({ id: 'imdb', name: 'IMDb', verb: 'rates', tenths: Math.round(input.imdb * 10) });
  const useStubbed = input.stubbedAvg !== null && input.stubbedCount >= STUBBED_MIN_RATINGS;
  if (useStubbed)
    src.push({
      id: 'stubbed',
      name: `${BRAND_NAME} users`,
      verb: 'rate',
      tenths: Math.round(input.stubbedAvg! * 10),
    });

  const names = src.map((s) =>
    s.id === 'stubbed' ? `${input.stubbedCount} ${BRAND_NAME} ratings` : s.name,
  );
  const sourceLine = `Based on ${
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }`;
  const sources = src.map((s) => s.id);

  const hi = src.reduce((a, b) => (b.tenths > a.tenths ? b : a));
  const lo = src.reduce((a, b) => (b.tenths < a.tenths ? b : a));
  if (src.length >= 2 && hi.tenths - lo.tenths >= 15) {
    return {
      key: 'split_opinions',
      word: VERDICT_WORDS.split_opinions,
      sourceLine,
      splitNote: `${hi.name} ${hi.verb} it higher than ${lo.name}`,
      sources,
    };
  }
  const sum = src.reduce((a, s) => a + s.tenths, 0);
  // m >= X  ⇔  sum >= X·n (all in tenths, exact integers).
  const n = src.length;
  const key: VerdictKey =
    sum >= 80 * n
      ? 'widely_loved'
      : sum >= 73 * n
        ? 'well_liked'
        : sum >= 65 * n
          ? 'solid_pick'
          : 'mixed_reviews';
  return { key, word: VERDICT_WORDS[key], sourceLine, splitNote: null, sources };
}

/* ------------------------------------------------------------------ */
/* "If you liked…" (line 6, P1)                                          */
/* ------------------------------------------------------------------ */

/** Recommended keys → listed catalogue titles, most popular first, excluding the title itself. */
export function pickLikeCandidates(
  selfKey: TitleSummary['key'],
  recommended: Iterable<TitleSummary>,
): TitleSummary[] {
  const seen = new Set<string>([selfKey]);
  const out: TitleSummary[] = [];
  for (const t of recommended) {
    if (!t.isListed || seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(t);
  }
  return out
    .sort((a, b) => b.popularity - a.popularity || (a.key < b.key ? -1 : 1))
    .slice(0, LIKE_MAX);
}

/* ------------------------------------------------------------------ */
/* Whole block                                                          */
/* ------------------------------------------------------------------ */

export interface WorthItInput {
  title: TitleSummary;
  enrichment: TitleEnrichment;
  /** Full TMDB overview when available (detail), else the index's overviewShort is used. */
  overview?: string | null;
  directors?: string[];
  stats: Pick<TitleStats, 'ratingAvg10' | 'ratingCount'>;
  /** Titles resolved from enrichment.recommendationKeys (any order; filtered here). */
  recommended?: TitleSummary[];
}

function metaTime(t: TitleSummary): string {
  if (t.mediaType === 'movie')
    return pos(t.runtimeMinutes) ? formatRuntime(t.runtimeMinutes).toLowerCase() : '';
  const bits: string[] = [];
  if (pos(t.seasonCount)) bits.push(`${t.seasonCount} season${t.seasonCount === 1 ? '' : 's'}`);
  const total = tvTotalMinutes(t);
  if (total !== null) bits.push(hoursApprox(total, false).toLowerCase());
  return bits.join(', ');
}

/** "{hook} {time} · {verdict}", <= 160 chars (F5). The hook is shortened first if needed. */
export function metaDescription(hook: PitchHook | null, t: TitleSummary, verdict: Verdict): string {
  const tail = [metaTime(t), verdict.word].filter(Boolean).join(' · ');
  if (!hook) return tail.slice(0, META_MAX);
  const room = META_MAX - tail.length - 1;
  return `${truncateWords(hook.text, Math.max(room, 20))} ${tail}`.slice(0, META_MAX);
}

export function buildWorthIt(input: WorthItInput): WorthIt {
  const t = input.title;
  const e = input.enrichment;
  const hook = pickHook({
    title: t,
    pitchHook: e.pitchHook,
    tagline: e.tagline,
    overview: input.overview,
    directors: input.directors,
  });
  const verdict = verdictFor({
    tmdb: t.voteAverage,
    imdb: t.imdbRating,
    stubbedAvg: input.stats.ratingAvg10,
    stubbedCount: input.stats.ratingCount,
  });
  return {
    hook,
    vibes: vibesFor({
      mediaType: t.mediaType,
      genreIds: t.genres.map((g) => g.id),
      keywords: e.keywords,
      totalMinutes: tvTotalMinutes(t),
    }),
    time: timeCommitment(t, t.mediaType === 'tv' ? e.seriesStatus : null),
    certification: clean(e.certification) || null,
    verdict,
    likeCandidates: pickLikeCandidates(t.key, input.recommended ?? []),
    metaDescription: metaDescription(hook, t, verdict),
  };
}
