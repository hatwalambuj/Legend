'use client';
/**
 * Half-star rating input (DESIGN §6): 5 stars × 2 half targets = 10 radios in a radiogroup.
 * Arrow keys step by half a star; Home/End jump. Value is rating10 (1..10); 0 = not rated yet.
 */
import { useRef, useState } from 'react';
import { Icon } from './Icon';
import styles from './StarInput.module.css';

export function StarInput({
  value,
  onChange,
  label = 'Rating, half stars allowed',
  invalid = false,
  describedBy,
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = hover ?? value;
  const focusable = value > 0 ? value : 1;

  const set = (v: number, focus = false) => {
    const c = Math.min(10, Math.max(1, v));
    onChange(c);
    if (focus) refs.current[c - 1]?.focus();
  };

  return (
    <div className={styles.wrap}>
      <div
        className={styles.stars}
        role="radiogroup"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onMouseLeave={() => setHover(null)}
        onKeyDown={(e) => {
          const cur = value || 0;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(cur + 1, true);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(cur - 1, true);
          else if (e.key === 'Home') set(1, true);
          else if (e.key === 'End') set(10, true);
          else return;
          e.preventDefault();
        }}
      >
        {[1, 2, 3, 4, 5].map((i) => {
          const fill = Math.max(0, Math.min(2, shown - (i - 1) * 2)) * 50;
          return (
            <span key={i} className={styles.star}>
              <Icon name="star" size={32} />
              <span className={styles.fill} style={{ width: `${fill}%` }}>
                <Icon name="star" size={32} />
              </span>
              {[i * 2 - 1, i * 2].map((v) => (
                <button
                  key={v}
                  ref={(el) => {
                    refs.current[v - 1] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={value === v}
                  aria-label={`${v / 2} star${v === 2 ? '' : 's'}`}
                  tabIndex={v === focusable ? 0 : -1}
                  className={v % 2 ? styles.left : styles.right}
                  onClick={() => set(v)}
                  onMouseEnter={() => setHover(v)}
                />
              ))}
            </span>
          );
        })}
      </div>
      <span className={styles.val} aria-hidden="true">
        {shown ? `${shown / 2}/5` : '–/5'}
      </span>
    </div>
  );
}
