// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Review } from '@/lib/types';
import { Reviews, stubbedReviewCount } from './Reviews';
import { renderWithApp } from './test-utils';

// The composer is replaced by two buttons that report a create and an edit (C-04).
vi.mock('./ReviewComposer', () => ({
  ReviewComposer: ({ onSaved }: { onSaved: (r: Review, created: boolean) => void }) => (
    <div>
      <button type="button" onClick={() => onSaved(review('mine'), true)}>
        fake-create
      </button>
      <button type="button" onClick={() => onSaved(review('mine'), false)}>
        fake-edit
      </button>
    </div>
  ),
}));

function review(id: string): Review {
  return {
    id,
    titleKey: 'movie:1',
    author: {
      id: 'u',
      handle: 'maya',
      displayName: 'Maya',
      bio: '',
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00Z',
    },
    rating10: 8,
    body: '',
    isSpoiler: false,
    stubId: null,
    stubNumber: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    editedAt: null,
  };
}

const target = {
  key: 'movie:1' as const,
  mediaType: 'movie' as const,
  tmdbId: 1,
  title: 'Anora',
  year: 2024,
};
const session = {
  user: { id: 'u', email: 'm@x.y', handle: 'maya', displayName: 'Maya', avatarUrl: null },
};

afterEach(cleanup);

describe('stubbedReviewCount (R10, C-04)', () => {
  const list = [review('a'), review('b')];
  it('adds one for a first review not in the list', () => {
    expect(stubbedReviewCount(2, list, 'new', null)).toBe(3);
  });
  it('does not double count once the list holds it', () => {
    expect(stubbedReviewCount(3, [...list, review('new')], 'new', null)).toBe(3);
  });
  it('drops a deleted server review and a deleted new one', () => {
    expect(stubbedReviewCount(2, list, null, 'a')).toBe(1);
    expect(stubbedReviewCount(2, list, 'new', 'new')).toBe(2);
  });
});

describe('Reviews count label', () => {
  it('create → +1, edit → +0', () => {
    renderWithApp(
      <Reviews
        target={target}
        initial={{ items: [review('a')], nextCursor: null }}
        tmdbReviews={[]}
        reviewCount={1}
      />,
      { session },
    );
    expect(screen.getByRole('button', { name: /· 1$/ })).toBeTruthy();
    act(() => fireEvent.click(screen.getByText('fake-create')));
    expect(screen.getByRole('button', { name: /· 2$/ })).toBeTruthy();
    act(() => fireEvent.click(screen.getByText('fake-edit')));
    expect(screen.getByRole('button', { name: /· 2$/ })).toBeTruthy();
  });
});
