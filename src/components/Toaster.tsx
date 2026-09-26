'use client';
/** Light toasts (DESIGN §6): bottom centre above the tab bar, max 2, role=status. */
import { useApp } from '@/hooks/useApp';
import { Icon } from './Icon';
import styles from './Toaster.module.css';

export function Toaster() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${styles.toast} ${t.leaving ? styles.out : ''}`}
          data-testid="toast"
        >
          <Icon name="ticket" size={20} className={styles.icon} />
          <span className={styles.msg}>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
