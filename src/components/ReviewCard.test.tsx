// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Review } from '@/lib/types';
import { ReviewCard } from './ReviewCard';

afterEach(cleanup);

const review: Review = {
  id: 'r1',
  titleKey: 'tv:76331',
  author: { id: 'u1', handle: 'priya', displayName: 'Priya', bio: '', avatarUrl: null, createdAt: '2022-01-01T00:00:00Z' },
  rating10: 9,
  body: 'The finale <b>vote</b> is devastating.',
  isSpoiler: true,
  stubId: 's1',
  stubNumber: 2,
  createdAt: '2026-03-02T10:00:00Z',
  updatedAt: '2026-03-03T10:00:00Z',
  editedAt: '2026-03-03T10:00:00Z',
};

describe('ReviewCard (A6-AC2 spoilers)', () => {
  it('hides spoiler text from assistive tech until revealed, renders text not HTML', () => {
    const { container } = render(<ReviewCard review={review} />);
    const body = container.querySelector('[data-spoiler]')!;
    expect(body.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByRole('img', { name: '4.5 out of 5 stars' })).toBeTruthy();
    expect(screen.getByText('STUB #2')).toBeTruthy();
    expect(screen.getByText('EDITED')).toBeTruthy();
    fireEvent.click(screen.getByTestId('spoiler-toggle'));
    expect(body.getAttribute('aria-hidden')).toBeNull();
    expect(screen.queryByTestId('spoiler-toggle')).toBeNull();
    expect(body.textContent).toContain('<b>vote</b>');
  });
});
