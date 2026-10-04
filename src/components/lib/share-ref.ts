/**
 * `ref=share` capture (ADR-013 C-07): first-party, per tab (sessionStorage, not a cookie). It only feeds
 * the anonymous `signup_completed` dim. Never throws (storage may be blocked).
 */
export const SHARE_REF_KEY = 'stubbed_ref';

export function captureShareRef(search: string): void {
  try {
    if (new URLSearchParams(search).get('ref') === 'share')
      window.sessionStorage.setItem(SHARE_REF_KEY, 'share');
  } catch {
    /* storage blocked */
  }
}

export function readShareRef(): 'share' | undefined {
  try {
    return window.sessionStorage.getItem(SHARE_REF_KEY) === 'share' ? 'share' : undefined;
  } catch {
    return undefined;
  }
}
