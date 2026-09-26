/**
 * Opaque keyset cursors for user-data lists (diary, wallet, reviews, watchlist). ADR-003 semantics:
 * base64url(JSON {k: kind, t: tuple}); a malformed cursor, or one minted for another list/sort, is
 * ignored (the list restarts at page 1) — it never errors.
 * The catalogue uses its own frozen format in src/lib/catalog-order.ts.
 * OWNER: Backend. Isomorphic, no server-only imports (unit-tested directly).
 */

export type KeysetValue = string | number;
export type KeysetTuple = KeysetValue[];

export function encodeKeyset(kind: string, tuple: KeysetTuple): string {
  return Buffer.from(JSON.stringify({ k: kind, t: tuple }), 'utf8').toString('base64url');
}

/** Returns the tuple, or null when absent/malformed/for another kind or arity. */
export function decodeKeyset(
  cursor: string | null | undefined,
  kind: string,
  arity: number,
): KeysetTuple | null {
  if (!cursor || cursor.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      k?: unknown;
      t?: unknown;
    };
    if (parsed.k !== kind || !Array.isArray(parsed.t) || parsed.t.length !== arity) return null;
    if (
      !parsed.t.every((v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
    )
      return null;
    return parsed.t as KeysetTuple;
  } catch {
    return null;
  }
}

/** Per-position direction: 1 = ascending, -1 = descending. */
export type Directions = readonly (1 | -1)[];

export function compareKeyset(a: KeysetTuple, b: KeysetTuple, dirs: Directions): number {
  for (let i = 0; i < dirs.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x < y) return -dirs[i]!;
    if (x > y) return dirs[i]!;
  }
  return 0;
}

/**
 * Reference keyset pagination over an in-memory array (demo repositories). `tupleOf` must produce a
 * total order (end in a unique id). Returns the page and the cursor of its last row when more exist.
 */
export function keysetPage<T>(
  rows: readonly T[],
  opts: {
    kind: string;
    dirs: Directions;
    tupleOf: (row: T) => KeysetTuple;
    cursor?: string | null;
    limit: number;
  },
): { items: T[]; nextCursor: string | null } {
  const { kind, dirs, tupleOf, limit } = opts;
  const withKeys = rows.map((r) => ({ r, k: tupleOf(r) }));
  withKeys.sort((a, b) => compareKeyset(a.k, b.k, dirs));
  const after = decodeKeyset(opts.cursor, kind, dirs.length);
  const start = after ? withKeys.findIndex((x) => compareKeyset(x.k, after, dirs) > 0) : 0;
  if (start < 0) return { items: [], nextCursor: null };
  const slice = withKeys.slice(start, start + limit);
  const hasMore = start + limit < withKeys.length;
  const last = slice[slice.length - 1];
  return {
    items: slice.map((x) => x.r),
    nextCursor: hasMore && last ? encodeKeyset(kind, last.k) : null,
  };
}
