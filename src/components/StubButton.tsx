'use client';
/**
 * Ticket quick action (DESIGN §3.3/§3.4): "+ Stub it" → "✓ N×". Tap stubs (optimistic, tear, toast);
 * a 550 ms long-press opens the "Stub with details" sheet (C2).
 */
import { useRef } from 'react';
import { useApp, useTitleState, type StubTarget } from '@/hooks/useApp';
import { Icon } from './Icon';
import styles from './Ticket.module.css';

const LONG_PRESS_MS = 550;

export function StubButton({ target }: { target: StubTarget }) {
  const app = useApp();
  const state = useTitleState(target.key);
  const n = state?.stubCount ?? 0;
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({
    timer: null,
    fired: false,
  });

  const cancel = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  };

  return (
    <button
      type="button"
      className={`${styles.act} ${n ? styles.on : ''}`}
      data-testid="stub-button"
      data-count={n}
      aria-label={n ? `Stub again: ${target.title} (${n}× stubbed)` : `Stub it: ${target.title}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        press.current.fired = false;
        cancel();
        press.current.timer = setTimeout(() => {
          press.current.fired = true;
          try {
            navigator.vibrate?.(20);
          } catch {
            /* haptics are an enhancement */
          }
          app.openStubSheet(target);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        if (press.current.fired) e.preventDefault();
      }}
      onClick={(e) => {
        if (press.current.fired) {
          press.current.fired = false;
          e.preventDefault();
          return;
        }
        void app.stub(target, { source: e.currentTarget });
      }}
    >
      <Icon name={n ? 'check' : 'plus'} size={14} />
      <span className={styles.actLabel}>
        {n ? <span data-testid="stub-count">{n}×</span> : 'Stub it'}
      </span>
    </button>
  );
}
