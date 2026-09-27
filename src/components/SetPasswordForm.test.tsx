// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api-client';
import { ERROR_COPY } from '@/lib/errors';
import { SetPasswordForm } from './SetPasswordForm';
import { renderWithApp } from './test-utils';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function type(v: string) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: v } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
}

describe('SetPasswordForm (M1-12, ADR-010 ID-2)', () => {
  it('validates length inline without calling the API', () => {
    const set = vi.spyOn(api, 'setPassword').mockResolvedValue(undefined);
    renderWithApp(<SetPasswordForm />);
    type('short');
    expect(screen.getByText('8+ characters')).toBeTruthy();
    expect(screen.getByLabelText('New password').getAttribute('aria-invalid')).toBe('true');
    type('x'.repeat(73));
    expect(screen.getByText('At most 72 characters')).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });

  it('saves the password, clears the field and confirms', async () => {
    const set = vi.spyOn(api, 'setPassword').mockResolvedValue(undefined);
    renderWithApp(<SetPasswordForm />);
    type('a-new-password');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Password updated. Other devices stay signed in.',
      ),
    );
    expect(set).toHaveBeenCalledWith({ password: 'a-new-password' });
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
  });

  it('on reauth_required explains why, opens sign-in and keeps the typed password', async () => {
    vi.spyOn(api, 'setPassword').mockRejectedValue(
      new ApiError(401, 'reauth_required', ERROR_COPY.reauth_required),
    );
    const { value } = renderWithApp(<SetPasswordForm />);
    type('a-new-password');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Sign in again to change your password.',
      ),
    );
    expect(value.openAuth).toHaveBeenCalledWith({ kind: 'signin' }, 'signin');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(
      'a-new-password',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(value.openAuth).toHaveBeenCalledTimes(2);
  });

  it('on forbidden (seeded demo account) shows the server reason, not "try again"', async () => {
    const reason = "Demo accounts can't change their password. Create your own to try it.";
    vi.spyOn(api, 'setPassword').mockRejectedValue(new ApiError(403, 'forbidden', reason));
    renderWithApp(<SetPasswordForm />);
    type('a-new-password');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(reason));
  });
});
