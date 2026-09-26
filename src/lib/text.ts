/**
 * Text normalisation shared by the sync job, the Postgres `search_text` column and the demo store,
 * so search behaves identically in every mode. OWNER: Architect. FROZEN.
 */

/** Lowercase, strip diacritics ("Shōgun" → "shogun"), collapse non-alphanumerics to single spaces. */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Sort key for title tie-breaks. Compared with plain `<` in JS and `COLLATE "C"` in Postgres,
 * which agree for all BMP characters. Leading articles are kept (no "The" stripping) for simplicity.
 */
export function sortTitle(title: string): string {
  return normalizeSearch(title);
}

/** URL slug: "Dune: Part Two" → "dune-part-two". Never empty. */
export function slugify(title: string): string {
  const s = normalizeSearch(title).replace(/\s+/g, '-').slice(0, 80).replace(/-+$/g, '');
  return s || 'title';
}

/** Truncate on a word boundary with an ellipsis. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
