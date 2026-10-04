'use client';
/**
 * Avatar colour picker (ADR-013 C-12, B3-AC2): `role="radiogroup"` of 8 swatches with a live preview.
 * Roving tabindex: Tab enters the group once, arrows move and select (WAI-ARIA radio pattern). Saves
 * through `PATCH /api/me/profile`; the header shows it after the next session read (reload).
 */
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { AVATAR_COLOR_LABELS, AVATAR_COLORS } from '@/lib/avatar';
import type { AvatarColor } from '@/lib/types';
import { useApp } from '@/hooks/useApp';
import { Avatar } from './Avatar';
import styles from './AvatarColorPicker.module.css';

export function AvatarColorPicker({
  handle,
  name,
  initial,
}: {
  handle: string;
  name: string;
  initial: AvatarColor | null;
}) {
  const app = useApp();
  const router = useRouter();
  const uid = useId();
  const [value, setValue] = useState<AvatarColor | null>(initial);
  const [saved, setSaved] = useState<AvatarColor | null>(initial);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIdx = Math.max(0, value ? AVATAR_COLORS.indexOf(value) : 0);

  async function save(next: AvatarColor) {
    const prev = saved;
    setBusy(true);
    try {
      await api.updateProfile({ avatarColor: next });
      setSaved(next);
      app.toast({ message: `Avatar colour: ${AVATAR_COLOR_LABELS[next]}` });
      router.refresh();
    } catch (e) {
      setValue(prev);
      app.toast({
        message:
          e instanceof ApiError && e.code === 'not_implemented'
            ? "That isn't switched on yet. Try again in a bit."
            : "Couldn't save your avatar colour. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  function pick(i: number, focus = false) {
    const next = AVATAR_COLORS[(i + AVATAR_COLORS.length) % AVATAR_COLORS.length]!;
    if (focus) refs.current[AVATAR_COLORS.indexOf(next)]?.focus();
    if (next === value) return;
    setValue(next);
    void save(next);
  }

  return (
    <div className={styles.wrap}>
      <Avatar handle={handle} name={name} color={value} size={56} />
      <div>
        <span id={`${uid}-l`} className="lbl">
          Avatar colour
        </span>
        <div
          role="radiogroup"
          aria-labelledby={`${uid}-l`}
          aria-busy={busy}
          className={styles.group}
          data-testid="avatar-color-picker"
          onKeyDown={(e) => {
            const i = value ? AVATAR_COLORS.indexOf(value) : -1;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              pick(i + 1, true);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              pick(i < 0 ? AVATAR_COLORS.length - 1 : i - 1, true);
            } else if (e.key === 'Home') {
              e.preventDefault();
              pick(0, true);
            } else if (e.key === 'End') {
              e.preventDefault();
              pick(AVATAR_COLORS.length - 1, true);
            }
          }}
        >
          {AVATAR_COLORS.map((c, i) => (
            <button
              key={c}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === c}
              aria-label={AVATAR_COLOR_LABELS[c]}
              tabIndex={i === focusIdx ? 0 : -1}
              className={styles.swatch}
              style={{
                backgroundImage: `linear-gradient(135deg, var(--avatar-${c}-a), var(--avatar-${c}-b))`,
              }}
              data-testid={`avatar-color-${c}`}
              onClick={() => pick(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
