// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvatarColorPicker } from './AvatarColorPicker';
import { renderWithApp } from './test-utils';

const updateProfile = vi.fn(async (_: unknown) => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({
  api: { updateProfile: (i: unknown) => updateProfile(i) },
  ApiError: class extends Error {},
}));

afterEach(() => {
  cleanup();
  updateProfile.mockClear();
});

describe('AvatarColorPicker (C-12)', () => {
  it('is a radiogroup of 8 named swatches with one tab stop', () => {
    renderWithApp(<AvatarColorPicker handle="maya" name="Maya" initial="ocean" />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(8);
    expect(screen.getByRole('radio', { name: 'Sunset' })).toBeTruthy();
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Ocean' }).getAttribute('aria-checked')).toBe('true');
  });

  it('arrow keys move, select and save', async () => {
    renderWithApp(<AvatarColorPicker handle="maya" name="Maya" initial="ocean" />);
    const ocean = screen.getByRole('radio', { name: 'Ocean' });
    ocean.focus();
    await act(async () => {
      fireEvent.keyDown(ocean, { key: 'ArrowRight' });
    });
    const forest = screen.getByRole('radio', { name: 'Forest' });
    expect(forest.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(forest);
    expect(updateProfile).toHaveBeenCalledWith({ avatarColor: 'forest' });
    await act(async () => {
      fireEvent.keyDown(forest, { key: 'ArrowLeft' });
    });
    expect(updateProfile).toHaveBeenLastCalledWith({ avatarColor: 'ocean' });
  });
});
