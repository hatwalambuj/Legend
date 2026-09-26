// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTACT_EMAIL } from '@/lib/contact';
import { DemoPill } from './DemoPill';
import { Footer } from './Footer';

afterEach(cleanup);

describe('DemoPill (PRD E2, GAP-04)', () => {
  it('reads "Demo data" with an explanation by default', () => {
    render(<DemoPill />);
    const pill = screen.getByTestId('demo-pill');
    expect(pill.textContent).toBe('Demo data');
    expect(pill.getAttribute('aria-label')).toMatch(/^Demo data\. /);
  });

  it('reads "Demo: data resets" and explains it when demo data is not durable', () => {
    render(<DemoPill resets />);
    const pill = screen.getByTestId('demo-pill');
    expect(pill.textContent).toBe('Demo: data resets');
    expect(pill.getAttribute('aria-label')).toMatch(/^Demo: data resets\. .*wiped/);
    expect(pill.getAttribute('title')).toMatch(/wiped/);
  });
});

describe('Footer contact (GAP-06)', () => {
  it('shows a Contact mailto with the address as text', () => {
    render(<Footer />);
    const link = screen.getByTestId('footer-contact');
    expect(link.getAttribute('href')).toMatch(new RegExp(`^mailto:${CONTACT_EMAIL}`));
    expect(link.textContent).toBe(`Contact ${CONTACT_EMAIL}`);
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('/about#terms');
  });
});
