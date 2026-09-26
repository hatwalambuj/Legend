import { describe, expect, it } from 'vitest';
import {
  CONTACT_EMAIL_PLACEHOLDER,
  contactHref,
  reportReviewHref,
  resolveContactEmail,
} from '@/lib/contact';

describe('contact config (GAP-06)', () => {
  it('uses NEXT_PUBLIC_CONTACT_EMAIL when valid, else the harmless placeholder', () => {
    expect(resolveContactEmail(' hello@stubbed.app ')).toBe('hello@stubbed.app');
    for (const bad of [undefined, '', '  ', 'not-an-email', 'a@b', 'x@y.z?cc=evil@x.test'])
      expect(resolveContactEmail(bad), String(bad)).toBe(CONTACT_EMAIL_PLACEHOLDER);
    expect(CONTACT_EMAIL_PLACEHOLDER).toMatch(/@example\.com$/);
  });
  it('builds mailto links with the review id', () => {
    expect(contactHref('hi@stubbed.app')).toBe('mailto:hi@stubbed.app?subject=Stubbed');
    const href = reportReviewHref({ id: 'r-123', titleKey: 'movie:13' }, 'hi@stubbed.app');
    const u = new URL(href);
    expect(u.protocol).toBe('mailto:');
    expect(u.pathname).toBe('hi@stubbed.app');
    expect(u.searchParams.get('subject')).toBe('Report review r-123');
    expect(u.searchParams.get('body')).toContain('Review id: r-123\nTitle: movie:13\n');
    expect(href).not.toContain('+');
  });
});
