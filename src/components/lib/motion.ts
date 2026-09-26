'use client';
/**
 * Stub interaction motion (DESIGN §5.2): tear-off clone flying into the wallet, micro-shake, badge bump.
 * Everything is skipped under prefers-reduced-motion (the stamp/label/toast still update).
 */
import styles from '../Ticket.module.css';

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function haptic(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
      navigator.vibrate(pattern);
  } catch {
    /* enhancement only */
  }
}

/** The ticket (and its paper stub) a stub action belongs to. */
export function findTicket(
  key: string,
  source?: HTMLElement | null,
): { ticket: HTMLElement | null; stub: HTMLElement | null } {
  if (typeof document === 'undefined') return { ticket: null, stub: null };
  const ticket =
    source?.closest<HTMLElement>('[data-ticket]') ??
    document.querySelector<HTMLElement>(`[data-ticket="${key}"]`);
  return { ticket, stub: ticket?.querySelector<HTMLElement>('[data-stub-paper]') ?? null };
}

export function shake(el: HTMLElement | null): void {
  if (!el || prefersReducedMotion()) return;
  const cls = styles.shake;
  if (!cls) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function walletTarget(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[data-wallet-target]');
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function bumpBadge(): void {
  if (prefersReducedMotion()) return;
  const target = walletTarget();
  const badge = target?.querySelector<HTMLElement>('[data-wallet-badge]');
  badge?.animate?.(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }],
    { duration: 360, easing: 'cubic-bezier(.3,1.5,.5,1)' },
  );
}

/** 1000 ms WAAPI timeline on a fixed-position clone of the stub. Resolves when done (or skipped). */
export function tearToWallet(stubEl: HTMLElement | null): Promise<void> {
  if (!stubEl || prefersReducedMotion() || typeof document === 'undefined')
    return Promise.resolve();
  const target = walletTarget();
  const r = stubEl.getBoundingClientRect();
  if (!target || r.width === 0) return Promise.resolve();
  const tr = target.getBoundingClientRect();

  const fly = document.createElement('div');
  fly.className = styles.fly ?? '';
  fly.setAttribute('aria-hidden', 'true');
  const clone = stubEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button, a, [id], [data-testid]').forEach((n) => {
    n.removeAttribute('id');
    n.removeAttribute('data-testid');
    if (n instanceof HTMLElement) n.tabIndex = -1;
  });
  clone.style.height = `${r.height}px`;
  fly.appendChild(clone);
  Object.assign(fly.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  document.body.appendChild(fly);

  const dx = tr.left + tr.width / 2 - (r.left + r.width / 2);
  const dy = tr.top + tr.height / 2 - (r.top + r.height / 2);
  if (typeof fly.animate !== 'function') {
    fly.remove();
    return Promise.resolve();
  }
  const anim = fly.animate(
    [
      { transform: 'translate(0,0) rotate(0)', offset: 0, easing: 'cubic-bezier(.2,.8,.2,1)' },
      {
        transform: 'translate(2px,4px) rotate(-4deg)',
        offset: 0.14,
        easing: 'cubic-bezier(.55,0,.75,.05)',
      },
      {
        transform: 'translate(12px,34px) rotate(8deg) scale(.97)',
        offset: 0.38,
        easing: 'cubic-bezier(.5,0,.2,1)',
      },
      {
        transform: `translate(${dx}px,${dy}px) rotate(22deg) scale(.12)`,
        opacity: 0.35,
        offset: 1,
      },
    ],
    { duration: 1000, easing: 'linear' },
  );
  return anim.finished
    .catch(() => undefined)
    .then(() => {
      fly.remove();
      bumpBadge();
    });
}
