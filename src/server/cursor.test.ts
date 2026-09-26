import { describe, expect, it } from 'vitest';
import { compareKeyset, decodeKeyset, encodeKeyset, keysetPage } from './cursor';

describe('keyset cursor', () => {
  it('round-trips and rejects other kinds, arities and garbage (→ page 1)', () => {
    const c = encodeKeyset('diary', ['2026-09-01', '2026-09-01T10:00:00Z', 'abc']);
    expect(decodeKeyset(c, 'diary', 3)).toEqual(['2026-09-01', '2026-09-01T10:00:00Z', 'abc']);
    expect(decodeKeyset(c, 'wallet', 3)).toBeNull();
    expect(decodeKeyset(c, 'diary', 2)).toBeNull();
    expect(decodeKeyset('not-a-cursor', 'diary', 3)).toBeNull();
    expect(decodeKeyset(encodeKeyset('diary', [{}] as never), 'diary', 1)).toBeNull();
    expect(decodeKeyset('x'.repeat(600), 'diary', 3)).toBeNull();
    expect(decodeKeyset(null, 'diary', 3)).toBeNull();
  });

  it('compares with mixed directions', () => {
    expect(compareKeyset([2, 'a'], [1, 'b'], [-1, 1])).toBeLessThan(0);
    expect(compareKeyset([1, 'a'], [1, 'b'], [-1, 1])).toBeLessThan(0);
    expect(compareKeyset([1, 'b'], [1, 'b'], [-1, 1])).toBe(0);
  });

  it('pages through every row exactly once, stable under inserts before the cursor', () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({
      d: `2026-01-${String((i % 9) + 1).padStart(2, '0')}`,
      id: `id${String(i).padStart(2, '0')}`,
    }));
    const opts = {
      kind: 't',
      dirs: [-1, 1] as const,
      tupleOf: (r: (typeof rows)[number]) => [r.d, r.id],
    };
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const p: { items: typeof rows; nextCursor: string | null } = keysetPage(rows, {
        ...opts,
        cursor,
        limit: 5,
      });
      seen.push(...p.items.map((r) => r.id));
      cursor = p.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(5);
    expect(new Set(seen).size).toBe(23);
    const first = keysetPage(rows, { ...opts, limit: 5 });
    // A newer row appears after page 1 was served: page 2 is unaffected (keyset, not offset).
    const more = [{ d: '2026-01-31', id: 'new' }, ...rows];
    const second = keysetPage(more, { ...opts, cursor: first.nextCursor, limit: 5 });
    expect(second.items.map((r) => r.id)).toEqual(
      keysetPage(rows, { ...opts, cursor: first.nextCursor, limit: 5 }).items.map((r) => r.id),
    );
    expect(keysetPage([], { ...opts, limit: 5 })).toEqual({ items: [], nextCursor: null });
  });
});
