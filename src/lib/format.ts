/**
 * Display formatting for scores and counts, shared by every ticket stub, score chip and aria-label.
 * OWNER: Architect. FROZEN. Pure and isomorphic (safe in client components).
 *
 * ADR-008: every ticket shows `TMDB x.x` and, when known, an `IMDb x.x` chip. The IMDb chip is
 * hidden when `imdbRating` is null — it is never rendered as 0 or "N/A".
 */
import type { TitleSummary } from './types';

/** One-decimal score: 8 → "8.0", 8.25 → "8.3". */
export function formatScore(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Compact count: 950 → "950", 6_912 → "6.9k", 684_000 → "684k", 2_950_000 → "3M", 1_250_000 → "1.3M". */
export function formatCount(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  const trim = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  if (v < 999_500) {
    const k = v / 1000;
    const r = k < 10 ? Math.round(k * 10) / 10 : Math.round(k);
    if (r < 1000) return `${trim(r)}k`;
  }
  const m = Math.round((v / 1_000_000) * 10) / 10;
  return `${trim(m)}M`;
}

export interface ScoreDisplay {
  source: 'tmdb' | 'imdb';
  /** Visible label: "TMDB" | "IMDb". */
  label: string;
  /** "8.2" */
  value: string;
  /** "6.9k votes", or null when the vote count is unknown. */
  votes: string | null;
  /** Full accessible text, e.g. "Rated 8.2 on TMDB, 6.9k votes". */
  ariaLabel: string;
}

type Scored = Pick<TitleSummary, 'voteAverage' | 'voteCount' | 'imdbRating' | 'imdbVotes'>;

/**
 * The scores to render for a title, in display order: TMDB always, IMDb only when known.
 * Components map over this; they never test `imdbRating` themselves.
 */
export function titleScores(t: Scored): ScoreDisplay[] {
  const out: ScoreDisplay[] = [];
  const tmdbVotes = `${formatCount(t.voteCount)} votes`;
  out.push({
    source: 'tmdb',
    label: 'TMDB',
    value: formatScore(t.voteAverage),
    votes: tmdbVotes,
    ariaLabel: `Rated ${formatScore(t.voteAverage)} on TMDB, ${tmdbVotes}`,
  });
  if (t.imdbRating !== null && Number.isFinite(t.imdbRating) && t.imdbRating > 0) {
    const votes = t.imdbVotes !== null ? `${formatCount(t.imdbVotes)} votes` : null;
    out.push({
      source: 'imdb',
      label: 'IMDb',
      value: formatScore(t.imdbRating),
      votes,
      ariaLabel: `Rated ${formatScore(t.imdbRating)} on IMDb${votes ? `, ${votes}` : ''}`,
    });
  }
  return out;
}

/** Source line for the detail-page IMDb score chip (DESIGN §6, E1 attribution). */
export const IMDB_SOURCE_LABEL = 'IMDb rating · via OMDb';

/**
 * Accessible name for a ticket (PRD A7-AC6): "Dune: Part Two, movie, 2024, rated 8.2 on TMDB and 8.5 on IMDb".
 * v1.6 (ADR-013 C-01): appends ", on Netflix" when the list call returned a `watchHint`.
 */
export function ticketAccessibleName(
  t: Pick<TitleSummary, 'title' | 'mediaType' | 'year' | 'voteAverage' | 'imdbRating'> & {
    watchHint?: TitleSummary['watchHint'];
  },
): string {
  const kind = t.mediaType === 'movie' ? 'movie' : 'show';
  const imdb =
    t.imdbRating !== null && t.imdbRating > 0 ? ` and ${formatScore(t.imdbRating)} on IMDb` : '';
  const on = t.watchHint ? `, on ${t.watchHint.name}` : '';
  return `${t.title}, ${kind}, ${t.year}, rated ${formatScore(t.voteAverage)} on TMDB${imdb}${on}`;
}

/** v1.6 (ADR-013 C-10): season label printed on stubs: 3 → "S03", 12 → "S12"; null → "" (whole show). */
export function seasonLabel(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isInteger(n) || n < 1) return '';
  return `S${String(n).padStart(2, '0')}`;
}
