/**
 * Contact + report addresses (GAP-06), client-safe. `NEXT_PUBLIC_CONTACT_EMAIL` is inlined at build time;
 * the default is a reserved example.com placeholder so nothing is ever sent to a real stranger.
 * OWNER: Backend (config). Used by the footer "Contact" link and the "Report" item on reviews.
 */

export const CONTACT_EMAIL_PLACEHOLDER = 'contact@example.com';

/** Pure resolver (exported for tests): trims, falls back to the placeholder on empty/invalid values. */
export function resolveContactEmail(raw: string | undefined): string {
  const v = raw?.trim() ?? '';
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(v) ? v : CONTACT_EMAIL_PLACEHOLDER;
}

export const CONTACT_EMAIL = resolveContactEmail(process.env.NEXT_PUBLIC_CONTACT_EMAIL);

function mailto(subject: string, body?: string, to = CONTACT_EMAIL): string {
  const q = new URLSearchParams({ subject, ...(body ? { body } : {}) })
    .toString()
    .replace(/\+/g, '%20'); // mail clients expect %20, not +
  return `mailto:${to}?${q}`;
}

/** Footer "Contact". */
export function contactHref(to = CONTACT_EMAIL): string {
  return mailto('Stubbed', undefined, to);
}

/** "Report" on someone else's review: the review id is all the founder needs to find the row. */
export function reportReviewHref(
  review: { id: string; titleKey?: string },
  to = CONTACT_EMAIL,
): string {
  return mailto(
    `Report review ${review.id}`,
    `Review id: ${review.id}\n${review.titleKey ? `Title: ${review.titleKey}\n` : ''}What's wrong with it?\n`,
    to,
  );
}
