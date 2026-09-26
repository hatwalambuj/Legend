// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api-client';
import { DeleteAccount } from './DeleteAccount';
import { renderWithApp } from './test-utils';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
  return screen.getByLabelText('Type DELETE to confirm');
}

describe('DeleteAccount (GAP-06)', () => {
  it('stays disabled until DELETE is typed, then deletes and signs out locally', async () => {
    const del = vi.spyOn(api, 'deleteAccount').mockResolvedValue(undefined);
    const { value } = renderWithApp(<DeleteAccount />);
    const input = open();
    expect(document.activeElement).toBe(input);
    const confirm = screen.getByRole('button', { name: 'Delete my account' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(input, { target: { value: 'delete' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);
    await waitFor(() => expect(value.signOut).toHaveBeenCalled());
    expect(del).toHaveBeenCalledTimes(1);
    expect(value.signOut).toHaveBeenCalledWith({
      remote: false,
      message: 'Your account and all its data are deleted.',
    });
  });

  it('shows the error inline and keeps the account when the request fails', async () => {
    vi.spyOn(api, 'deleteAccount').mockRejectedValue(
      new ApiError(500, 'internal', 'Something went wrong. Try again.'),
    );
    const { value } = renderWithApp(<DeleteAccount />);
    fireEvent.change(open(), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.');
    expect(value.signOut).not.toHaveBeenCalled();
  });

  it('Cancel closes the panel without calling the API', () => {
    const del = vi.spyOn(api, 'deleteAccount');
    renderWithApp(<DeleteAccount />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete account…' })).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });

  it('Escape cancels too', () => {
    renderWithApp(<DeleteAccount />);
    fireEvent.keyDown(open(), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Delete account…' })).toBeTruthy();
  });
});
