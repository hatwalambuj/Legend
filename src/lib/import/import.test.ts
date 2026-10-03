/** ADR-013 C-11 client-side parsers: CSV, ZIP (limits, bombs), Letterboxd, IMDb, TV Time, detection. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildZip } from '../../../tests/fixtures/imports/zip-helper';
import { csvTable, parseCsv } from './csv';
import { ImportError, MAX_FILE_BYTES } from './common';
import { detectAndParse, parseCsvImport } from './index';
import { starsToRating10 } from './letterboxd';
import { listZip, readZip } from './zip';

const fx = (name: string) => readFileSync(join('tests/fixtures/imports', name), 'utf8');
const file = (data: string | Uint8Array, name: string) =>
  Object.assign(new Blob([data as BlobPart]), { name });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ImportError ? e.code : String(e);
  }
};

describe('csv', () => {
  it('handles BOM, CRLF, quotes, escaped quotes and newlines in fields', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi""\nok"\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"\nok'],
    ]);
    expect(csvTable('Watched Date,Name\n2024-01-01,X').records).toEqual([
      { 'watched date': '2024-01-01', name: 'X' },
    ]);
  });
});

describe('letterboxd', () => {
  it('maps stars to rating10 (0.5 → 1, 4.5 → 9, empty → null)', () => {
    expect(starsToRating10('0.5')).toBe(1);
    expect(starsToRating10('4.5')).toBe(9);
    expect(starsToRating10('')).toBeNull();
  });

  it('diary.csv: one row per watch, movies only, rewatch flag', () => {
    const p = parseCsvImport(fx('letterboxd-diary.csv'), 'diary.csv');
    expect(p.source).toBe('letterboxd');
    expect(p.rows).toHaveLength(4);
    expect(p.rows[0]).toEqual({
      ref: 'diary:1',
      mediaType: 'movie',
      title: 'The Shawshank Redemption',
      year: 1994,
      watchedOn: '2024-01-01',
      rating10: 9,
    });
    expect(p.rows[1]!.rewatch).toBe(true);
    expect(p.rows[2]!.rating10).toBeNull();
  });

  it('a ZIP merges reviews into diary rows and adds ratings only for films not in the diary', async () => {
    const zip = buildZip([
      { name: 'letterboxd-export/diary.csv', data: fx('letterboxd-diary.csv') },
      { name: 'letterboxd-export/reviews.csv', data: fx('letterboxd-reviews.csv'), method: 0 },
      { name: 'letterboxd-export/ratings.csv', data: fx('letterboxd-ratings.csv') },
      { name: 'letterboxd-export/profile.json', data: '{}' },
    ]);
    const p = await detectAndParse(file(zip, 'letterboxd.zip'));
    expect(p.label).toBe('Letterboxd diary + reviews + ratings');
    expect(p.rows).toHaveLength(5);
    expect(p.rows[1]!.review).toBe('Still great.\nSecond line, with "quotes".');
    expect(p.rows[4]).toMatchObject({ ref: 'rating:5', title: 'Breaking Bad', rating10: 8 });
    expect(p.rows[4]!.watchedOn).toBeNull();
  });

  it('our own export round-trips (tmdbID → movie)', () => {
    const csv =
      'tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review\r\n278,tt0111161,The Shawshank Redemption,1994,9,2024-01-01,false,"Hope."\r\n238,,The Godfather,1972,,,true,\r\n';
    const p = parseCsvImport(csv, 'stubbed-letterboxd.csv');
    expect(p.label).toBe('Stubbed export');
    expect(p.rows).toEqual([
      {
        ref: 'export:1',
        mediaType: 'movie',
        tmdbId: 278,
        imdbId: 'tt0111161',
        title: 'The Shawshank Redemption',
        year: 1994,
        watchedOn: '2024-01-01',
        rating10: 9,
        review: 'Hope.',
      },
      {
        ref: 'export:2',
        mediaType: 'movie',
        tmdbId: 238,
        title: 'The Godfather',
        year: 1972,
        watchedOn: null,
        rating10: null,
        rewatch: true,
      },
    ]);
  });
});

describe('imdb', () => {
  it('maps types; other title types are skipped as invalid', async () => {
    const p = await detectAndParse(file(fx('imdb-ratings.csv'), 'ratings.csv'));
    expect(p.source).toBe('imdb');
    expect(p.rows.map((r) => [r.imdbId, r.mediaType, r.rating10, r.watchedOn])).toEqual([
      ['tt0111161', 'movie', 10, '2023-06-01'],
      ['tt0903747', 'tv', 9, '2023-06-02'],
    ]);
    expect(p.skipped).toEqual([
      { ref: 'imdb:3', title: 'Some Episode', year: 2010, reason: 'invalid' },
    ]);
  });
});

describe('tvtime (beta, alias table)', () => {
  it('one stub per (show, season) at the last episode; one per movie', async () => {
    const zip = buildZip([
      { name: 'seen_episode.csv', data: fx('tvtime-seen_episode.csv') },
      { name: 'movies.csv', data: fx('tvtime-movies.csv') },
    ]);
    const p = await detectAndParse(file(zip, 'tvtime.zip'));
    expect(p.source).toBe('tvtime');
    const shows = p.rows.filter((r) => r.mediaType === 'tv');
    expect(shows.map((r) => [r.title, r.season, r.watchedOn])).toEqual([
      ['Breaking Bad', 1, '2022-01-03'],
      ['Breaking Bad', 2, '2022-02-01'],
    ]);
    expect(p.rows.find((r) => r.mediaType === 'movie')).toMatchObject({
      title: 'The Godfather',
      imdbId: 'tt0068646',
      watchedOn: '2022-05-05',
    });
  });
});

describe('limits', () => {
  it('rejects a file over 10 MB before reading it', async () => {
    const big = {
      size: MAX_FILE_BYTES + 1,
      name: 'x.csv',
      arrayBuffer: () => {
        throw new Error('read');
      },
    };
    expect(await code(detectAndParse(big as unknown as Blob & { name: string }))).toBe('too_large');
  });

  it('unknown formats, encryption, too many entries and zip bombs fail with a code', async () => {
    expect(await code(detectAndParse(file('a,b\n1,2', 'x.csv')))).toBe('unknown_format');
    expect(await code(readZip(buildZip([{ name: 'a.csv', data: 'x', flags: 1 }])))).toBe(
      'zip_encrypted',
    );
    const many = buildZip(Array.from({ length: 51 }, (_, i) => ({ name: `${i}.csv`, data: 'x' })));
    expect(await code(readZip(many))).toBe('zip_too_many_entries');
    // 2 MB of zeros deflates to a few KB: the inflated size is counted while streaming.
    const bomb = buildZip([{ name: 'diary.csv', data: new Uint8Array(2 * 1024 * 1024) }]);
    const limits = { maxEntries: 50, maxEntryBytes: 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024 };
    expect(await code(readZip(bomb, undefined, limits))).toBe('zip_entry_too_large');
    const two = buildZip([
      { name: 'a.csv', data: new Uint8Array(700_000) },
      { name: 'b.csv', data: new Uint8Array(700_000) },
    ]);
    expect(
      await code(
        readZip(two, undefined, { maxEntries: 50, maxEntryBytes: 1e6, maxTotalBytes: 1e6 }),
      ),
    ).toBe('zip_too_large');
    expect(() => listZip(new Uint8Array([1, 2, 3]))).toThrow(ImportError);
  });

  it('caps rows at 20,000', () => {
    const csv = ['Const,Your Rating,Date Rated,Title,Title Type,Year']
      .concat(
        Array.from(
          { length: 20_001 },
          (_, i) => `tt${String(i).padStart(7, '0')},5,2020-01-01,T,movie,2000`,
        ),
      )
      .join('\n');
    expect(() => parseCsvImport(csv)).toThrow(ImportError);
  });
});
