'use client';
/** Promise-based confirm sheet ("Stub again today?", "Delete your review?"). */
import { useEffect, useRef } from 'react';
import type { ConfirmInput } from '@/hooks/useApp';
import { Sheet, SheetButtons, SheetSub, SheetTitle } from './Sheet';

export function ConfirmDialog({
  state,
  onDone,
}: {
  state: ConfirmInput | null;
  onDone: (ok: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // React's autoFocus runs before Sheet's effect calls showModal(), and showModal() then focuses the
  // first button (Cancel). Focus the intended button once the dialog is open (this effect runs after
  // the child Sheet's). Destructive confirms focus Cancel, so a stray Enter never deletes anything.
  useEffect(() => {
    if (state) (state.danger ? cancelRef : confirmRef).current?.focus();
  }, [state]);
  return (
    <Sheet
      open={state !== null}
      onClose={() => onDone(false)}
      labelledBy="confirm-h"
      describedBy={state?.body ? 'confirm-sub' : undefined}
      testId="confirm-dialog"
    >
      {state && (
        <>
          <SheetTitle id="confirm-h">{state.title}</SheetTitle>
          {state.body && <SheetSub id="confirm-sub">{state.body}</SheetSub>}
          <SheetButtons>
            <button
              ref={cancelRef}
              type="button"
              className="btn btn--ghost"
              onClick={() => onDone(false)}
            >
              {state.cancelLabel ?? 'Cancel'}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={`btn ${state.danger ? 'btn--danger' : 'btn--primary'}`}
              onClick={() => onDone(true)}
            >
              {state.confirmLabel}
            </button>
          </SheetButtons>
        </>
      )}
    </Sheet>
  );
}
