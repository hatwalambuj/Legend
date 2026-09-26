'use client';
/** Blurred spoiler body: aria-hidden + unselectable until revealed, so screen readers don't leak it. */
import { useState } from 'react';
import styles from './ReviewCard.module.css';

export function SpoilerBody({ children, className }: { children: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${styles.spoiler} ${open ? styles.revealed : ''}`}>
      <p className={className} aria-hidden={open ? undefined : true} data-spoiler={open ? 'shown' : 'hidden'}>
        {children}
      </p>
      {!open && (
        <button
          type="button"
          className={`btn btn--ghost btn--sm ${styles.spoilerBtn}`}
          onClick={() => setOpen(true)}
          data-testid="spoiler-toggle"
        >
          Show spoiler
        </button>
      )}
    </div>
  );
}
