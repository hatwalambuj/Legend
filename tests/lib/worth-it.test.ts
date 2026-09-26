import { describe, expect, it } from 'vitest';
import catalogJson from '@/fixtures/catalog.json';
import seedJson from '@/fixtures/seed.json';
import type { FixtureCatalog, FixtureSeed } from '@/fixtures/schema';
import type { TitleSummary, VerdictKey } from '@/lib/types';
import {
  GENRE_VIBES,
  KEYWORD_VIBES,
  VIBE_LABELS,
  isSpoilerKeyword,
  normalizeKeyword,
  vibesFor,
} from '@/lib/vibes';
import {
  HOOK_MAX,
  META_MAX,
  buildWorthIt,
  firstSentence,
  formatRuntime,
  pickHook,
  pickLikeCandidates,
  ticketTimeLabel,
  timeCommitment,
  truncateWords,
  verdictFor,
} from '@/lib/worth-it';
import { toEnrichment, toSummary } from '@/server/repositories/memory/catalog';

const catalog = catalogJson as unknown as FixtureCatalog;
const seed = seedJson as unknown as FixtureSeed;

const movie = (over: Partial<TitleSummary> = {}): TitleSummary => ({
  ...toSummary(
    catalog.titles.find((t) => t.key === 'movie:693134')!,
    true,
  ),
  ...over,
});

describe('vibe mapping table (F1-AC5)', () => {
  it('allowlists no spoiler keyword and keeps labels <= 18 chars', () => {
    const bad = Object.keys(KEYWORD_VIBES).filter(isSpoilerKeyword);
    expect(bad).toEqual([]);
    for (const k of Object.keys(KEYWORD_VIBES)) expect(normalizeKeyword(k)).toBe(k);
    for (const label of Object.values(VIBE_LABELS)) expect(label.length).toBeLessThanOrEqual(18);
    for (const w of [...Object.values(KEYWORD_VIBES), ...Object.values(GENRE_VIBES)])
      for (const [id] of w) expect(VIBE_LABELS[id]).toBeDefined();
  });
  it('ignores unknown and spoiler keywords; caps at 3; needs score >= 2', () => {
    expect(
      vibesFor({ mediaType: 'movie', genreIds: [], keywords: ['twist ending', 'death of hero'] }),
    ).toEqual([]);
    expect(vibesFor({ mediaType: 'movie', genreIds: [18], keywords: [] })).toEqual([]); // one weak signal
    const v = vibesFor({
      mediaType: 'movie',
      genreIds: [35, 28, 53, 27],
      keywords: ['time travel', 'dark comedy'],
    });
    expect(v).toHaveLength(3);
    expect(v[0]!.id).toBe('funny'); // 2 (genre) + 2 (dark comedy)
  });
  it('short TV shows are bingeable', () => {
    expect(
      vibesFor({ mediaType: 'tv', genreIds: [], keywords: [], totalMinutes: 300 }).map((x) => x.id),
    ).toEqual(['bingeable']);
  });
});

describe('hook (PRD §4.2 line 1)', () => {
  const t = movie();
  it('prefers our hook, then a short tagline, then the first overview sentence, then a template', () => {
    expect(
      pickHook({ title: t, pitchHook: 'Ours.', tagline: 'Tag.', overview: 'Ov. Two.' }),
    ).toEqual({
      text: 'Ours.',
      source: 'stubbed',
    });
    expect(
      pickHook({ title: t, pitchHook: null, tagline: 'Tag.', overview: 'Ov. Two.' })?.source,
    ).toBe('tmdb_tagline');
    const longTag = 'x'.repeat(HOOK_MAX + 1);
    expect(
      pickHook({ title: t, pitchHook: null, tagline: longTag, overview: 'First one. Second one.' }),
    ).toEqual({ text: 'First one.', source: 'tmdb_overview' });
    expect(
      pickHook({
        title: { ...t, overviewShort: '' },
        pitchHook: null,
        tagline: null,
        overview: '',
        directors: ['Denis Villeneuve'],
      }),
    ).toEqual({ text: 'A 2024 science fiction movie from Denis Villeneuve.', source: 'template' });
  });
  it('cuts long sentences at a word boundary with an ellipsis', () => {
    const s = truncateWords('word '.repeat(60), HOOK_MAX);
    expect(s.length).toBeLessThanOrEqual(HOOK_MAX);
    expect(s.endsWith('word…')).toBe(true);
    expect(firstSentence('Hello there! And more.')).toBe('Hello there!');
  });
});

describe('time commitment (line 3, F2)', () => {
  it('formats movies with short/long badges', () => {
    expect(formatRuntime(166)).toBe('2H 46M');
    expect(formatRuntime(120)).toBe('2H');
    expect(formatRuntime(45)).toBe('45M');
    expect(timeCommitment(movie({ runtimeMinutes: 166 }))?.label).toBe('2H 46M · LONG ONE');
    expect(timeCommitment(movie({ runtimeMinutes: 88 }))?.badge).toBe('short_one');
    expect(timeCommitment(movie({ runtimeMinutes: null }))).toBeNull();
    expect(ticketTimeLabel(movie({ runtimeMinutes: 166 }))).toBe('2024 · 2H 46M');
    expect(ticketTimeLabel(movie({ runtimeMinutes: null }))).toBe('2024');
  });
  it('formats shows with totals, status and binge badges', () => {
    const show = movie({
      mediaType: 'tv',
      year: 2022,
      runtimeMinutes: null,
      seasonCount: 4,
      episodeCount: 36,
      episodeRuntimeMinutes: 55,
    });
    expect(timeCommitment(show, 'ended')?.label).toBe(
      '4 SEASONS · 36 EPS · ~55 MIN · ≈33 H · ENDED',
    );
    expect(ticketTimeLabel(show)).toBe('2022 · 4 SEASONS · ≈33H');
    expect(ticketTimeLabel({ ...show, episodeRuntimeMinutes: null })).toBe('2022 · 4 SEASONS');
    expect(timeCommitment({ ...show, episodeCount: 6, episodeRuntimeMinutes: 60 })?.badge).toBe(
      'weekend_binge',
    );
    expect(timeCommitment({ ...show, episodeCount: 100 })?.badge).toBe('big_commitment');
  });
});

describe('verdict (line 5, F3)', () => {
  const v = (tmdb: number, imdb: number | null, avg: number | null = null, n = 0) =>
    verdictFor({ tmdb, imdb, stubbedAvg: avg, stubbedCount: n });
  it('matches the PRD examples', () => {
    expect(v(8.2, 8.5).word).toBe('Widely loved');
    const split = v(7.0, 8.6);
    expect(split.word).toBe('Split opinions');
    expect(split.splitNote).toBe('IMDb rates it higher than TMDB');
    expect(v(6.8, null).word).toBe('Solid pick');
    expect(v(6.8, null).sourceLine).toBe('Based on TMDB');
  });
  it('uses exact thresholds and names only the sources used', () => {
    expect(v(8.0, null).key).toBe('widely_loved');
    expect(v(7.9, 8.0).key).toBe('well_liked'); // mean 7.95
    expect(v(7.3, null).key).toBe('well_liked');
    expect(v(7.2, null).key).toBe('solid_pick');
    expect(v(6.5, null).key).toBe('solid_pick');
    expect(v(6.4, 5.3).key).toBe('mixed_reviews');
    expect(v(7.0, 8.4).key).toBe('well_liked'); // diff 1.4 → not split
    expect(v(8.2, 8.5, 8.4, 4).sources).toEqual(['tmdb', 'imdb']); // < 5 Stubbed ratings ignored
    const three = v(8.2, 8.5, 8.4, 12);
    expect(three.sourceLine).toBe('Based on TMDB, IMDb and 12 Stubbed ratings');
    expect(v(6.8, 7.0, 5.0, 5).splitNote).toBe('IMDb rates it higher than Stubbed users');
  });
});

describe('"Worth it?" on the demo fixtures (F4)', () => {
  const statsFor = (key: string) => {
    const r = seed.reviews.filter((x) => x.titleKey === key);
    return {
      ratingCount: r.length,
      ratingAvg10: r.length >= 5 ? r.reduce((a, x) => a + x.rating10, 0) / r.length : null,
    };
  };
  const summaries = new Map(catalog.titles.map((t) => [t.key, toSummary(t, true)]));
  const blocks = catalog.titles.map((t) =>
    buildWorthIt({
      title: toSummary(t, true),
      enrichment: toEnrichment(t),
      overview: t.overview,
      directors: t.directors,
      stats: statsFor(t.key),
      recommended: t.recommendationKeys.map((k) => summaries.get(k)!),
    }),
  );

  it('every title has a hook, <= 3 vibes, a verdict and a meta description within limits', () => {
    for (const b of blocks) {
      expect(b.hook).not.toBeNull();
      expect(b.hook!.text.length).toBeLessThanOrEqual(HOOK_MAX);
      expect(b.vibes.length).toBeLessThanOrEqual(3);
      expect(b.metaDescription.length).toBeLessThanOrEqual(META_MAX);
      expect(b.likeCandidates.length).toBeLessThanOrEqual(6);
    }
    expect(blocks.filter((b) => b.hook!.source === 'stubbed').length).toBeGreaterThanOrEqual(65);
    expect(new Set(blocks.map((b) => b.hook!.source))).toEqual(
      new Set(['stubbed', 'tmdb_tagline', 'tmdb_overview']),
    );
  });

  it('covers every verdict (F3-AC4) and the QA edge cases', () => {
    const keys = new Set<VerdictKey>(blocks.map((b) => b.verdict.key));
    for (const k of [
      'widely_loved',
      'well_liked',
      'solid_pick',
      'split_opinions',
      'mixed_reviews',
    ] as const)
      expect(keys.has(k), k).toBe(true);
    const tv = catalog.titles.filter((t) => t.mediaType === 'tv');
    expect(tv.some((t) => t.episodeRuntimeMinutes === null)).toBe(true); // F2-AC1
    expect(catalog.titles.some((t) => t.certification === null)).toBe(true); // hidden cert chip
    const zombieland = catalog.titles.find((t) => t.key === 'movie:19908')!;
    expect([zombieland.voteAverage, zombieland.imdbRating]).toEqual([6.4, 7.5]); // A7-AC5
  });

  it('"If you liked…" keeps listed titles only, most popular first, never itself', () => {
    const a = movie({ key: 'movie:1', popularity: 1 });
    const b = movie({ key: 'movie:2', popularity: 9 });
    const hidden = movie({ key: 'movie:3', popularity: 99, isListed: false });
    expect(pickLikeCandidates('movie:1', [a, hidden, b, b]).map((x) => x.key)).toEqual(['movie:2']);
  });
});
