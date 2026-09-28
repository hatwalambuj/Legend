// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AboutPage from './page';

// ADR-010 ID-6: the privacy summary lists what we store; v1.5 adds the watch region (ADR-012 §3, §7).
describe('About privacy summary', () => {
  it('discloses the saved watch region and the region cookie', () => {
    render(<AboutPage />);
    const privacy = screen.getByRole('region', { name: /your data & privacy/i });
    expect(privacy.textContent).toMatch(/Where to watch.{0,3} country\. That.s it\./);
    expect(privacy.textContent).toMatch(/cookie on this\s+device, even when you.re signed out/);
    expect(privacy.textContent).toMatch(/watchlist and settings\./);
  });
});
