'use client';
/** Promise-based confirm sheet ("Stub again today?", "Delete your review?"). */
import type { ConfirmInput } from '@/hooks/useApp';
import { Sheet, SheetButtons, SheetSub, SheetTitle } from './Sheet';

export function ConfirmDialog({
  state,
  onDone,
}: {
  state: ConfirmInput | null;
  onDone: (ok: boolean) => void;
}) {
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
            {/* Destructive confirms focus Cancel, so a stray Enter never deletes anything. */}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onDone(false)}
              autoFocus={Boolean(state.danger)}
            >
              {state.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={`btn ${state.danger ? 'btn--danger' : 'btn--primary'}`}
              onClick={() => onDone(true)}
              autoFocus={!state.danger}
            >
              {state.confirmLabel}
            </button>
          </SheetButtons>
        </>
      )}
    </Sheet>
  );
}
