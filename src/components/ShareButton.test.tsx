// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareButton, storyFileName } from './ShareButton';
import { renderWithApp } from './test-utils';

const trackEvent = vi.fn();
vi.mock('@/lib/analytics', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));

const target = {
  kind: 'title' as const,
  title: {
    mediaType: 'movie' as const,
    tmdbId: 693134,
    slug: 'dune-part-two',
    title: 'Dune: Part Two',
    year: 2024,
  },
};

function setNav(over: Record<string, unknown>) {
  for (const k of ['share', 'canShare', 'clipboard']) {
    Object.defineProperty(navigator, k, { value: over[k], configurable: true, writable: true });
  }
}

async function click() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Share Dune: Part Two' }));
  });
}

beforeEach(() => trackEvent.mockClear());
afterEach(() => {
  cleanup();
  setNav({});
});

describe('ShareButton (ADR-013 C-07)', () => {
  it('uses Web Share with an absolute ?ref=share link and no body text', async () => {
    const share = vi.fn(async () => {});
    setNav({ share, canShare: () => true });
    renderWithApp(<ShareButton target={target} surface="title" label="Share Dune: Part Two" />);
    await click();
    expect(share).toHaveBeenCalledTimes(1);
    const data = (share.mock.calls[0] as unknown as [{ url: string; text: string }])[0];
    expect(data.url).toMatch(/^https?:\/\/.+\/title\/movie\/693134-dune-part-two\?ref=share$/);
    expect(data.text).toBe('Dune: Part Two (2024) on Stubbed');
    expect(trackEvent).toHaveBeenCalledWith('share_generated', {
      surface: 'title',
      method: 'native',
    });
  });

  it('ignores AbortError (user closed the sheet)', async () => {
    const err = Object.assign(new Error('x'), { name: 'AbortError' });
    const writeText = vi.fn();
    setNav({ share: vi.fn(async () => Promise.reject(err)), clipboard: { writeText } });
    renderWithApp(<ShareButton target={target} surface="title" label="Share Dune: Part Two" />);
    await click();
    expect(writeText).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('copies the link and toasts when Web Share is missing', async () => {
    const writeText = vi.fn(async () => {});
    setNav({ clipboard: { writeText } });
    const { value } = renderWithApp(
      <ShareButton target={target} surface="title" label="Share Dune: Part Two" />,
    );
    await click();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('?ref=share'));
    expect(value.toast).toHaveBeenCalledWith({ message: 'Link copied' });
    expect(trackEvent).toHaveBeenCalledWith('share_generated', {
      surface: 'title',
      method: 'copy',
    });
  });

  it('opens the fallback sheet with the link when copying fails', async () => {
    setNav({ clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    renderWithApp(<ShareButton target={target} surface="title" label="Share Dune: Part Two" />);
    await click();
    const input = screen.getByTestId('share-fallback-url') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toContain('/title/movie/693134-dune-part-two?ref=share');
    expect(trackEvent).toHaveBeenCalledWith('share_generated', {
      surface: 'title',
      method: 'fallback',
    });
  });

  it('names the story file after the brand', () => {
    expect(storyFileName(3)).toBe('stubbed-stub-3.png');
  });
});
