// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODE } from '@/hooks/useApp';
import { AuthForm } from './AuthForm';
import { renderWithApp } from './test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
});
