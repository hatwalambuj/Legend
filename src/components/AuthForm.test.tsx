// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODE } from '@/hooks/useApp';
import { api } from '@/lib/api-client';
import type { Session } from '@/lib/types';
import { AuthForm } from './AuthForm';
import { renderWithApp } from './test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fillSignUp() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
  fireEvent.change(screen.getByLabelText('Handle'), { target: { value: 'maya' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}

describe('AuthForm (B1/B2)', () => {
  it('validates on blur and blocks submit with inline errors', () => {
    const onSuccess = vi.fn();
    renderWithApp(
      <AuthForm view="signup" onViewChange={vi.fn()} onSuccess={onSuccess} headingId="h" />,
    );
    const email = screen.getByLabelText('Email');
    fireEvent.change(email, { target: { value: 'nope' } });
    fireEvent.blur(email);
    expect(screen.getByText('Enter a valid email')).toBeTruthy();
    expect(email.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('8+ characters', { selector: '.field-error' })).toBeTruthy();
    expect(screen.getByText('3–20 characters: a–z, 0–9 and _')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows the generic credentials error and demo accounts', async () => {
    respond(401, {
      error: { code: 'invalid_credentials', message: "That email and password don't match." },
    });
    renderWithApp(
      <AuthForm view="signin" onViewChange={vi.fn()} onSuccess={vi.fn()} headingId="h" />,
      {
        mode: {
          ...DEFAULT_MODE,
          demoAccounts: [
            { handle: 'maya', email: 'maya@demo.stubbed.app', password: 'stubbed-demo' },
          ],
        },
      },
    );
    expect(screen.getByText(/Demo mode/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use @maya' }));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
      'maya@demo.stubbed.app',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        "That email and password don't match.",
      ),
    );
  });

  it('maps server field errors (handle taken) onto the input', async () => {
    respond(409, { error: { code: 'handle_taken', message: 'taken' } });
    const onSuccess = vi.fn();
    renderWithApp(
      <AuthForm view="signup" onViewChange={vi.fn()} onSuccess={onSuccess} headingId="h" />,
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
    fireEvent.change(screen.getByLabelText('Handle'), { target: { value: 'maya' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(screen.getByText('@maya is taken', { selector: '.field-error' })).toBeTruthy(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows "check your inbox" instead of signing in when sign-up needs email confirmation (ID-1)', async () => {
    vi.spyOn(api, 'handleAvailable').mockResolvedValue({ available: true });
    vi.spyOn(api, 'signUp').mockResolvedValue({ session: null, confirmEmail: true });
    const onSuccess = vi.fn();
    const onViewChange = vi.fn();
    renderWithApp(
      <AuthForm view="signup" onViewChange={onViewChange} onSuccess={onSuccess} headingId="h" />,
    );
    fillSignUp();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Check your inbox to finish signing up',
      ),
    );
    expect(screen.getByRole('heading', { name: 'Check your inbox' }).id).toBe('h');
    expect(screen.queryByTestId('auth-form')).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onViewChange).toHaveBeenCalledWith('signin');
  });

  it('signs in straight away when sign-up returns a session (demo, confirm email off)', async () => {
    vi.spyOn(api, 'handleAvailable').mockResolvedValue({ available: true });
    const session = { user: { id: 'u1', handle: 'maya' } } as unknown as Session;
    vi.spyOn(api, 'signUp').mockResolvedValue({ session });
    const onSuccess = vi.fn();
    renderWithApp(
      <AuthForm view="signup" onViewChange={vi.fn()} onSuccess={onSuccess} headingId="h" />,
    );
    fillSignUp();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(session));
    expect(screen.queryByTestId('auth-confirm-email')).toBeNull();
  });
});
