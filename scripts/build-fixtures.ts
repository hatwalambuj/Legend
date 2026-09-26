/**
 * Builds src/fixtures/catalog.json and src/fixtures/seed.json from scripts/fixtures/*.source.ts.
 * Runs fully offline. Deterministic output (fixed salts, fixed timestamps) so diffs stay reviewable.
 *
 *   npm run fixtures:build
 *
 * Palettes: the live sync job extracts colours from the real w92 poster (src/lib/palette.ts
 * `extractColors`). The container cannot reach image.tmdb.org, so fixtures use hand-picked
 * [vibrant, base] colours, then run the SAME clamping (`tintsFrom`) and render an 8x12 WebP LQIP
 * with sharp from a gradient of those colours.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { hexToRgb, tintsFrom } from '../src/lib/palette';
import { slugify, truncate } from '../src/lib/text';
import type { Palette, TitleKey, TmdbReview } from '../src/lib/types';
import type { FixtureCatalog, FixtureSeed, FixtureTitle } from '../src/fixtures/schema';
import { hashPassword } from '../src/server/auth/password';
import { MOVIE_GENRES, TITLES, TMDB_REVIEWS, TV_GENRES } from './fixtures/titles.source';
import { REVIEWS, STUBS, USERS, WATCHLIST } from './fixtures/seed.source';

const GENERATED_AT = '2026-09-26T00:00:00Z';
const DEMO_PASSWORD = 'stubbed-demo';
const OUT = join(process.cwd(), 'src', 'fixtures');

async function lqip(vibrant: string, base: string): Promise<string> {
  const [vr, vg, vb] = hexToRgb(vibrant);
  const [br, bg, bb] = hexToRgb(base);
  const w = 8;
  const h = 12;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = Math.min(1, (y / (h - 1)) * 0.8 + (x / (w - 1)) * 0.2);
      const i = (y * w + x) * 3;
      px[i] = Math.round(vr + (br - vr) * t);
      px[i + 1] = Math.round(vg + (bg - vg) * t);
      px[i + 2] = Math.round(vb + (bb - vb) * t);
    }
  }
  const webp = await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .webp({ quality: 40 })
    .toBuffer();
  return `data:image/webp;base64,${webp.toString('base64')}`;
}

async function buildCatalog(): Promise<FixtureCatalog> {
  const seen = new Set<string>();
  const titles: FixtureTitle[] = [];
  for (const s of TITLES) {
    const key = `${s.mediaType}:${s.tmdbId}` as TitleKey;
    if (seen.has(key)) throw new Error(`Duplicate fixture ${key}`);
    seen.add(key);
    // ADR-008: a title with an IMDb id must carry a real IMDb rating; without an id there is none.
    if (s.imdbId !== null && (s.imdbRating === null || s.imdbVotes === null))
      throw new Error(`Fixture ${key} has an imdbId but no imdbRating/imdbVotes`);
    if (s.imdbId === null && (s.imdbRating !== null || s.imdbVotes !== null))
      throw new Error(`Fixture ${key} has an imdbRating but no imdbId`);
    const genreMap = s.mediaType === 'movie' ? MOVIE_GENRES : TV_GENRES;
    const [vibrant, base] = s.colors;
    const palette: Palette = {
      vibrant,
      base,
      ...tintsFrom(vibrant, base),
      lqip: await lqip(vibrant, base),
      v: 1,
    };
    const tmdbReviews: TmdbReview[] = (TMDB_REVIEWS[key] ?? []).map((r, i) => ({
      id: createHash('sha1').update(`${key}:${i}`).digest('hex').slice(0, 24),
      author: r.author,
      rating: r.rating,
      content: r.content,
      createdAt: r.createdAt,
      url: `https://www.themoviedb.org/${s.mediaType}/${s.tmdbId}/reviews`,
    }));
    titles.push({
      key,
      mediaType: s.mediaType,
      tmdbId: s.tmdbId,
      imdbId: s.imdbId,
      imdbRating: s.imdbRating,
      imdbVotes: s.imdbVotes,
      title: s.title,
      originalTitle: s.originalTitle ?? s.title,
      slug: slugify(s.title),
      releaseDate: s.releaseDate,
      year: Number(s.releaseDate.slice(0, 4)),
      voteAverage: s.voteAverage,
      voteCount: s.voteCount,
      popularity: s.popularity,
      genres: s.genreIds.map((id) => {
        const name = genreMap[id];
        if (!name) throw new Error(`Unknown ${s.mediaType} genre ${id} on ${key}`);
        return { id, name };
      }),
      posterPath: s.posterPath,
      backdropPath: s.backdropPath,
      palette,
      overviewShort: truncate(s.overview, 300),
      runtimeMinutes: s.mediaType === 'movie' ? (s.runtime ?? null) : null,
      seasonCount: s.mediaType === 'tv' ? (s.seasons ?? null) : null,
      overview: s.overview,
      tagline: s.tagline ?? null,
      directors: s.directors,
      cast: s.cast.map(([name, character]) => ({ name, character, profilePath: null })),
      trailer: s.trailerKey
        ? { site: 'YouTube', key: s.trailerKey, name: 'Official Trailer' }
        : null,
      episodeCount: s.mediaType === 'tv' ? (s.episodes ?? null) : null,
      tmdbReviews,
      ...(s.edgeCase ? { edgeCase: s.edgeCase } : {}),
    });
  }
  return { generatedAt: GENERATED_AT, titles };
}

function buildSeed(catalogKeys: Set<string>): FixtureSeed {
  const byHandle = new Map(USERS.map((u) => [u.handle, u]));
  const uid = (handle: string) => {
    const u = byHandle.get(handle);
    if (!u) throw new Error(`Unknown seed user ${handle}`);
    return u.id;
  };
  const checkTitle = (k: string) => {
    if (!catalogKeys.has(k)) throw new Error(`Seed references unknown title ${k}`);
    return k as TitleKey;
  };
  return {
    generatedAt: GENERATED_AT,
    users: USERS.map((u, i) => ({
      id: u.id,
      handle: u.handle,
      email: u.email,
      displayName: u.displayName,
      bio: u.bio,
      avatarUrl: null,
      // Fixed salt per user → deterministic file. Demo only.
      passwordHash: hashPassword(
        DEMO_PASSWORD,
        createHash('sha256').update(`salt:${i}:${u.handle}`).digest().subarray(0, 16),
      ),
      createdAt: u.createdAt,
    })),
    stubs: STUBS.map((s) => {
      const at = `${s.watchedOn}T20:00:00Z`;
      return {
        id: s.id,
        userId: uid(s.user),
        titleKey: checkTitle(s.title),
        watchedOn: s.watchedOn,
        watchedWhere: s.watchedWhere,
        note: s.note ?? '',
        createdAt: at,
        updatedAt: at,
      };
    }),
    reviews: REVIEWS.map((r) => ({
      id: r.id,
      userId: uid(r.user),
      titleKey: checkTitle(r.title),
      rating10: r.rating10,
      body: r.body,
      isSpoiler: r.isSpoiler ?? false,
      stubId: r.stubId ?? null,
      createdAt: r.createdAt,
      updatedAt: r.editedAt ?? r.createdAt,
      editedAt: r.editedAt ?? null,
    })),
    watchlist: WATCHLIST.map((w) => ({
      userId: uid(w.user),
      titleKey: checkTitle(w.title),
      addedAt: w.addedAt,
    })),
  };
}

async function main() {
  const catalog = await buildCatalog();
  const seed = buildSeed(new Set(catalog.titles.map((t) => t.key)));
  writeFileSync(join(OUT, 'catalog.json'), `${JSON.stringify(catalog, null, 1)}\n`);
  writeFileSync(join(OUT, 'seed.json'), `${JSON.stringify(seed, null, 1)}\n`);
  console.log(
    `fixtures: ${catalog.titles.length} titles, ${seed.users.length} users, ${seed.stubs.length} stubs, ${seed.reviews.length} reviews`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
