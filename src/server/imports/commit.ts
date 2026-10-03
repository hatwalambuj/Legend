/**
 * Import preview + commit (ADR-013 C-11, API_CONTRACT §5.26–§5.27). Stateless: every call re-matches
 * the rows against our catalogue only (no outbound call) and trusts nothing from an earlier preview.
 *
 * Per row: invalid (nothing to match on, or a stub date outside the ADR-004 window) → not_in_stubbed
 * (no catalogue match) → duplicate (a stub on the same title + date already exists, any source; or a
 * dateless rating for an already reviewed title) → matched.
 * Commit: one stub per dated row (`source='import'`, idempotent `import_key`), one review per title
 * only where none exists (never overwritten; the latest rated row wins). 24 h row budget
 * (`IMPORT_MAX_ROWS_PER_DAY`, default 20,000) → 429. OWNER: Backend.
 */
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type {
  ImportCommitResponse,
  ImportPreviewItem,
  ImportPreviewResponse,
  ImportUnmatched,
  importCommitSchema,
  importPreviewSchema,
} from '@/lib/contracts';
import { IMPORT_COMMIT_MAX_ROWS, IMPORT_PREVIEW_MAX_ROWS } from '@/lib/contracts';
import { AppError, ERROR_COPY } from '@/lib/errors';
import type { ImportRow, ImportSource, Session, TitleKey, TitleSummary } from '@/lib/types';
import type { Container, ImportApplyRow, ImportExisting } from '@/server/ports';
import { LIMITS, enforce } from '@/server/rate-limit';
import { validateWatchedOn } from '@/server/services/stubs';
import { isMatchable, matchItemOf } from './match';

export const DEFAULT_IMPORT_MAX_ROWS_PER_DAY = 20_000;

/** `IMPORT_MAX_ROWS_PER_DAY` (1..20000; anything else → the default). */
export function importMaxRowsPerDay(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.IMPORT_MAX_ROWS_PER_DAY);
  return Number.isInteger(n) && n >= 1 && n <= DEFAULT_IMPORT_MAX_ROWS_PER_DAY
    ? n
    : DEFAULT_IMPORT_MAX_ROWS_PER_DAY;
}

type Status = 'matched' | 'duplicate' | 'not_in_stubbed' | 'invalid';

export interface Classified {
  row: ImportRow;
  status: Status;
  title: TitleSummary | null;
  /** Normalised: null when absent or outside the stub date window. */
  watchedOn: string | null;
  /** TV only and <= seasonCount when known, else null. */
  season: number | null;
}

const tooLarge = () => new AppError('payload_too_large', ERROR_COPY.payload_too_large);

function normSeason(row: ImportRow, t: TitleSummary): number | null {
  const s = row.season ?? null;
  if (s === null || t.mediaType !== 'tv') return null;
  return t.seasonCount !== null && s > t.seasonCount ? null : s;
}

/** Classifies rows (pure over the match + existing data; exported for tests). */
export async function classify(
  c: Pick<Container, 'catalog' | 'imports'>,
  userId: string,
  rows: ImportRow[],
  today: string,
): Promise<{ rows: Classified[]; existing: ImportExisting }> {
  const items = rows.map(matchItemOf);
  const matched = await c.catalog.match(items.filter(isMatchable));
  const keys = [...new Set([...matched.values()].map((t) => t.key))];
  const existing = await c.imports.existing(userId, keys);
  const out = rows.map((row, i): Classified => {
    const base = { row, title: null, watchedOn: null, season: null };
    if (!isMatchable(items[i]!)) return { ...base, status: 'invalid' };
    const t = matched.get(row.ref);
    if (!t) return { ...base, status: 'not_in_stubbed' };
    const watchedOn = row.watchedOn ?? null;
    if (watchedOn) {
      try {
        validateWatchedOn(watchedOn, t, today);
      } catch {
        return { ...base, title: t, status: 'invalid' };
      }
    }
    const season = normSeason(row, t);
    const dup = watchedOn
      ? existing.stubDays.has(`${t.key}|${watchedOn}`)
      : existing.reviewed.has(t.key);
    return { row, title: t, watchedOn, season, status: dup ? 'duplicate' : 'matched' };
  });
  return { rows: out, existing };
}

export async function previewImport(
  c: Container,
  session: Session,
  input: z.output<typeof importPreviewSchema>,
  today: string,
): Promise<ImportPreviewResponse> {
  if (input.rows.length > IMPORT_PREVIEW_MAX_ROWS) throw tooLarge();
  enforce(
    await c.rateLimiter.consume(
      `import_preview:${session.user.id}`,
      LIMITS.importPreview.max,
      LIMITS.importPreview.windowSec,
    ),
    'Too many previews in an hour. Try again later.',
  );
  const { rows: out } = await classify(c, session.user.id, input.rows, today);
  const counts = { total: out.length, matched: 0, duplicate: 0, notInStubbed: 0, invalid: 0 };
  const sample: ImportPreviewItem[] = [];
  const unmatched: ImportUnmatched[] = [];
  for (const r of out) {
    if (r.status === 'matched') {
      counts.matched++;
      if (sample.length < 50)
        sample.push({
          ref: r.row.ref,
          title: r.title!,
          watchedOn: r.watchedOn,
          rating10: r.row.rating10 ?? null,
          season: r.season,
        });
    } else if (r.status === 'duplicate') counts.duplicate++;
    else {
      if (r.status === 'invalid') counts.invalid++;
      else counts.notInStubbed++;
      if (unmatched.length < 500)
        unmatched.push({
          ref: r.row.ref,
          title: r.row.title ?? '',
          year: r.row.year ?? null,
          reason: r.status === 'invalid' ? 'invalid' : 'not_in_stubbed',
        });
    }
  }
  return { counts, sample, unmatched };
}

/** sha256(source|titleKey|watchedOn|season|ordinal): idempotent per (user, row) via a unique index. */
export function importKey(
  source: ImportSource,
  titleKey: TitleKey,
  watchedOn: string,
  season: number | null,
  ordinal: number,
): string {
  return createHash('sha256')
    .update(`${source}|${titleKey}|${watchedOn}|${season ?? ''}|${ordinal}`)
    .digest('hex');
}

export async function commitImport(
  c: Container,
  session: Session,
  input: z.output<typeof importCommitSchema>,
  today: string,
  opts: { maxRowsPerDay?: number; now?: () => number } = {},
): Promise<ImportCommitResponse & { final: boolean }> {
  if (input.rows.length > IMPORT_COMMIT_MAX_ROWS) throw tooLarge();
  const uid = session.user.id;
  const { rows: out, existing } = await classify(c, uid, input.rows, today);
  const { createStubs, ratings, reviews } = input.options;
  const skipped = { duplicate: 0, notInStubbed: 0, invalid: 0, existingReview: 0 };

  const apply: ImportApplyRow[] = [];
  const ordinals = new Map<string, number>();
  // The review of a title comes from its latest rated row (rows without a date count as oldest).
  const reviewOf = new Map<TitleKey, Classified>();
  for (const r of out) {
    if (r.status === 'invalid') skipped.invalid++;
    else if (r.status === 'not_in_stubbed') skipped.notInStubbed++;
    if (r.status === 'invalid' || r.status === 'not_in_stubbed') continue;
    const t = r.title!;
    if (r.row.rating10 != null && (ratings || reviews)) {
      const cur = reviewOf.get(t.key);
      if (!cur || (r.watchedOn ?? '') >= (cur.watchedOn ?? '')) reviewOf.set(t.key, r);
    }
    if (r.status === 'duplicate') {
      skipped.duplicate++;
      continue;
    }
    if (createStubs && r.watchedOn) {
      const g = `${t.key}|${r.watchedOn}|${r.season ?? ''}`;
      const ord = ordinals.get(g) ?? 0;
      ordinals.set(g, ord + 1);
      apply.push({
        titleKey: t.key,
        importKey: importKey(input.source, t.key, r.watchedOn, r.season, ord),
        watchedOn: r.watchedOn,
        season: r.season,
        rating10: null,
        body: '',
        isSpoiler: false,
      });
    }
  }
  for (const [key, r] of reviewOf) {
    if (existing.reviewed.has(key)) {
      skipped.existingReview++;
      continue;
    }
    apply.push({
      titleKey: key,
      importKey: null,
      watchedOn: null,
      season: null,
      rating10: r.row.rating10!,
      body: reviews ? (r.row.review ?? '').slice(0, 5000) : '',
      isSpoiler: reviews ? Boolean(r.row.isSpoiler) : false,
    });
  }

  const newStubs = apply.filter((a) => a.importKey).length;
  if (newStubs > 0) {
    const max = opts.maxRowsPerDay ?? importMaxRowsPerDay();
    const now = (opts.now ?? Date.now)();
    const used = await c.imports.importedSince(uid, new Date(now - 86_400_000).toISOString());
    if (used + newStubs > max)
      throw new AppError('rate_limited', ERROR_COPY.rate_limited_import, { retryAfter: 3600 });
  }
  const created = apply.length
    ? await c.imports.apply(uid, input.source, apply)
    : { stubs: 0, reviews: 0 };
  // Rows that were new here but already present in the DB (a concurrent re-send) are duplicates too.
  skipped.duplicate += Math.max(0, newStubs - created.stubs);
  return { created, skipped, final: input.final };
}
