/**
 * Brand name as config (ADR-013 C-15, F8 workaround). Client-safe; inlined at build time, so a rename
 * means a rebuild. Only user-visible copy uses it: cookie names, demo emails, DB and file names keep
 * "stubbed". OWNER: Backend (C-00).
 */
export const DEFAULT_BRAND_NAME = 'Stubbed';
export const BRAND_TAGLINE = 'only the good stuff';

const BRAND_RE = /^[\p{L}\p{N} .'&-]{1,24}$/u;

/** A trimmed, allowed brand name, else the default (never throws). */
export function brandName(raw: string | null | undefined): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v && BRAND_RE.test(v) ? v : DEFAULT_BRAND_NAME;
}

// Literal `process.env.NEXT_PUBLIC_BRAND_NAME` access so Next inlines it into client bundles.
export const BRAND_NAME: string = brandName(process.env.NEXT_PUBLIC_BRAND_NAME);
