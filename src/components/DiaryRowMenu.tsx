'use client';
/** Owner menu on a diary row: Edit (same sheet as C2, prefilled) and Delete (confirm, C4-AC1). */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type { DiaryEntry } from '@/lib/types';
import { useApp, useTitleState } from '@/hooks/useApp';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { StubDetailsForm } from './StubSheet';
import { stubTarget } from './Ticket';
import styles from './Diary.module.css';

export function DiaryRowMenu({ entry }: { entry: DiaryEntry }) {
  const app = useApp();
  const router = useRouter();
  const state = useTitleState(entry.titleKey);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const target = stubTarget(entry.title);

  const fail = (e: unknown) =>
    app.toast({
      message:
        e instanceof ApiError && e.code === 'not_implemented'
          ? "That isn't switched on yet. Try again in a bit."
          : e instanceof ApiError && e.code === 'validation_failed'
            ? (Object.values(e.fields ?? {})[0] ?? e.message)
            : "Couldn't save that change. Try again.",
    });

  async function remove() {
    setOpen(false);
    const left = state ? Math.max(0, state.stubCount - 1) : null;
    const ok = await app.confirm({
      title: 'Delete this stub?',
      body:
        left !== null
          ? `${entry.title.title} will show ${left}× stubbed.`
          : 'It comes off your diary and your count.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.deleteStub(entry.id);
      app.setTitleState(entry.titleKey, () => res.state);
      app.toast({ message: 'Stub deleted' });
      router.refresh();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.menuBtn}
        aria-label={`Options for ${entry.title.title}, ${entry.watchedOn}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <span className={styles.pop} role="group" aria-label="Stub options">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button type="button" onClick={() => void remove()}>
            Delete
          </button>
        </span>
      )}
      <Sheet open={editing} onClose={() => setEditing(false)} labelledBy={`edit-${entry.id}`}>
        {editing && (
          <StubDetailsForm
            target={target}
            initial={{
              watchedOn: entry.watchedOn,
              watchedWhere: entry.watchedWhere,
              note: entry.note,
            }}
            headingId={`edit-${entry.id}`}
            heading="Edit stub"
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (d) => {
              setEditing(false);
              try {
                const res = await api.updateStub(entry.id, d);
                app.setTitleState(entry.titleKey, () => res.state);
                app.toast({ message: 'Stub updated' });
                router.refresh();
              } catch (e) {
                fail(e);
              }
            }}
          />
        )}
      </Sheet>
    </>
  );
}
