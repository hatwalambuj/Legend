'use client';
import { useApp } from '@/hooks/useApp';

export function SignOutButton() {
  const { signOut } = useApp();
  return (
    <button type="button" className="btn btn--ghost" onClick={() => void signOut()} data-testid="sign-out">
      Sign out
    </button>
  );
}
