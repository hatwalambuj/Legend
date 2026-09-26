'use client';
/** Auth over the current page (DESIGN §7.6): bottom sheet on mobile, centred dialog on desktop. */
import { useApp } from '@/hooks/useApp';
import { AuthForm, type AuthView } from './AuthForm';
import { Sheet, SheetClose } from './Sheet';

export function AuthSheet({
  view,
  onViewChange,
  onClose,
}: {
  view: AuthView | null;
  onViewChange: (v: AuthView) => void;
  onClose: () => void;
}) {
  const { onAuthed } = useApp();
  return (
    <Sheet open={view !== null} onClose={onClose} labelledBy="auth-h" testId="auth-sheet">
      {view && (
        <>
          <SheetClose onClick={onClose} />
          <AuthForm
            key={view}
            view={view}
            onViewChange={onViewChange}
            onSuccess={(s) => onAuthed(s)}
            next={typeof window !== 'undefined' ? window.location.pathname : undefined}
            headingId="auth-h"
          />
        </>
      )}
    </Sheet>
  );
}
