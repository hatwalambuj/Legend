import { describe, expect, it } from 'vitest';
import { MemoryCatalogIndex } from '@/server/repositories/memory/catalog';
import { signSession, verifySession } from '@/server/auth/demo-session';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import seed from '@/fixtures/seed.json';

describe('demo catalogue index (fixtures)', () => {
  const repo = new MemoryCatalogIndex();

  it('lists >= 60 curated titles and never an excluded one', async () => {
    const page = await repo.list({ type: 'all', sort: 'rating_asc', limit: 50 });
    expect(page.total).toBeGreaterThanOrEqual(60);
    expect(page.items.every((t) => t.isListed && t.voteAverage >= 6.5)).toBe(true);
    expect(page.items[0]!.voteAverage).toBe(6.5);
  });

  it('filters by type and keeps unlisted titles reachable by URL (hysteresis)', async () => {
    const tv = await repo.list({ type: 'tv', sort: 'release_desc', limit: 50 });
    expect(tv.items.every((t) => t.mediaType === 'tv')).toBe(true);
    const twilight = await repo.get('movie', 8966);
    expect(twilight?.isListed).toBe(false);
  });

  it('search is accent-insensitive; excluded titles are "not in catalogue"', async () => {
    expect((await repo.search('shogun', 'all', 10)).map((t) => t.title)).toEqual(['Shōgun']);
    expect(await repo.search('twilight', 'all', 10)).toEqual([]);
  });
});

describe('demo auth primitives', () => {
  it('verifies the seeded demo password', () => {
    expect(verifyPassword('stubbed-demo', seed.users[0]!.passwordHash)).toBe(true);
    expect(verifyPassword('wrong', seed.users[0]!.passwordHash)).toBe(false);
    expect(verifyPassword('x', hashPassword('x'))).toBe(true);
  });
  it('signs and verifies session cookies; rejects tampering and expiry', () => {
    const tok = signSession('u1', 'secret');
    expect(verifySession(tok, 'secret')).toBe('u1');
    expect(verifySession(tok, 'other')).toBeNull();
    expect(verifySession(`${tok}x`, 'secret')).toBeNull();
    expect(verifySession(tok, 'secret', Date.now() + 1000 * 60 * 60 * 24 * 31)).toBeNull();
  });
});

describe('title payloads (ADR-008, PRD §4.2)', () => {
  it('every list item carries imdbRating/imdbVotes (null only without an IMDb id)', async () => {
    const { dal } = await import('@/server/dal');
    const page = await dal.listCatalog({ type: 'all', sort: 'rating_desc', limit: 50 });
    for (const t of page.items) {
      expect(t).toHaveProperty('imdbRating');
      expect(t).toHaveProperty('imdbVotes');
      expect(t).toHaveProperty('episodeRuntimeMinutes');
      expect(t.imdbRating === null).toBe(t.imdbId === null);
    }
  });

  it('title detail includes a complete "Worth it?" block and degrades without TMDB detail', async () => {
    const { dal } = await import('@/server/dal');
    const dune = await dal.getTitle('movie', 693134);
    expect(dune?.imdbRating).toBe(8.5);
    expect(dune?.worthIt.hook?.source).toBe('stubbed');
    expect(dune?.worthIt.time?.label).toBe('2H 46M · LONG ONE');
    expect(dune?.worthIt.certification).toBe('PG-13');
    expect(dune?.worthIt.verdict.word).toBe('Widely loved');
    expect(dune?.worthIt.likeCandidates.every((t) => t.isListed)).toBe(true);
    const bluey = await dal.getTitle('tv', 82728);
    expect(bluey?.imdbRating).toBeNull();
    expect(bluey?.worthIt.verdict.sources).toEqual(['tmdb']);
    const twilight = await dal.getTitle('movie', 8966);
    expect(twilight?.isListed).toBe(false);
    expect(twilight?.worthIt.verdict.key).toBe('mixed_reviews');
  });
});
