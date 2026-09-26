'use client';
/**
 * Native <dialog> sheet (DESIGN §6): bottom sheet on mobile, centred 440px dialog at >= 640px.
 * The browser provides the focus trap, Esc to close and focus return to the trigger.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Sheet.module.css';

export function Sheet({
  open,
  onClose,
  labelledBy,
  describedBy,
  children,
  testId,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  useEffect(() => {
    onCloseRef.current = onClose;
    openRef.current = open;
  }, [onClose, open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`${styles.sheet} ${wide ? styles.wide : ''}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-testid={testId}
      onClose={() => {
        // Only user-initiated closes (Esc, form method=dialog) report back; programmatic ones don't.
        if (openRef.current) onCloseRef.current();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      {open && (
        <div className={styles.inner}>
          <div className={styles.grab} aria-hidden="true" />
          {children}
        </div>
      )}
    </dialog>
  );
}

export function SheetTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className={styles.title}>
      {children}
    </h2>
  );
}

export function SheetSub({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className={styles.sub}>
      {children}
    </p>
  );
}

export function SheetButtons({ children }: { children: ReactNode }) {
  return <div className={styles.btns}>{children}</div>;
}

export function SheetClose({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className={styles.close} onClick={onClick} aria-label={label}>
      <Icon name="close" />
    </button>
  );
}
