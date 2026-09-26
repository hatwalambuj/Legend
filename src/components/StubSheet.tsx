'use client';
/**
 * "Stub with details" (DESIGN §5.3, C2): watched-on date (max today, min Jan 1 of release year − 1),
 * where (segmented), note (≤ 280). Also used to edit an existing diary stub.
 */
import { useId, useState } from 'react';
import type { WatchedWhere } from '@/lib/types';
import { useApp, type StubOptions, type StubTarget } from '@/hooks/useApp';
import { Icon } from './Icon';
import { WHERE_OPTIONS } from './lib/display';
import { Sheet, SheetButtons, SheetSub, SheetTitle } from './Sheet';

export interface StubDetails {
  watchedOn: string;
  watchedWhere: WatchedWhere | null;
  note: string;
}

export function StubDetailsForm({
  target,
  initial,
  minDate,
  submitLabel,
  onCancel,
  onSubmit,
  headingId,
  heading,
}: {
  target: StubTarget;
  initial?: Partial<StubDetails>;
  minDate?: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (d: StubDetails) => void;
  headingId: string;
  heading: string;
}) {
  const { today } = useApp();
  const [date, setDate] = useState(initial?.watchedOn ?? today);
  const [where, setWhere] = useState<WatchedWhere | null>(initial?.watchedWhere ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const min = minDate ?? `${target.year - 1}-01-01`;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!date || date > today) return setError("Pick a date that isn't in the future.");
        if (date < min) return setError(`Pick a date from ${min.slice(0, 4)} or later.`);
        onSubmit({ watchedOn: date, watchedWhere: where, note: note.trim() });
      }}
    >
      <SheetTitle id={headingId}>{heading}</SheetTitle>
      <SheetSub>
        {target.title} · {target.year}
      </SheetSub>
      <div className="field">
        <label htmlFor={`${uid}-date`}>Watched on</label>
        <input
          id={`${uid}-date`}
          type="date"
          required
          value={date}
          max={today}
          min={min}
          onChange={(e) => {
            setDate(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-err` : undefined}
        />
        {error && (
          <span id={`${uid}-err`} className="field-error" role="alert">
            <Icon name="alert" size={14} />
            {error}
          </span>
        )}
      </div>
      <div className="field">
        <span className="lbl" id={`${uid}-where`}>
          Where
        </span>
        <div
          className="seg"
          role="group"
          aria-labelledby={`${uid}-where`}
          style={{ flexWrap: 'wrap' }}
        >
          {WHERE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={where === o.value}
              onClick={() => setWhere(where === o.value ? null : o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-note`}>
          Note <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </label>
        <textarea
          id={`${uid}-note`}
          maxLength={280}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Who you watched with, how it hit…"
          aria-describedby={`${uid}-count`}
        />
        <span id={`${uid}-count`} className="counter" aria-live="polite">
          {note.length} / 280
        </span>
      </div>
      <SheetButtons>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary">
          <Icon name="ticket" />
          {submitLabel}
        </button>
      </SheetButtons>
    </form>
  );
}

export function StubSheet({
  target,
  minDate,
  onClose,
  onSubmit,
}: {
  target: StubTarget | null;
  minDate?: string;
  onClose: () => void;
  onSubmit: (target: StubTarget, opts: StubOptions) => void;
}) {
  return (
    <Sheet open={target !== null} onClose={onClose} labelledBy="stub-sheet-h" testId="stub-sheet">
      {target && (
        <StubDetailsForm
          key={target.key}
          target={target}
          minDate={minDate}
          headingId="stub-sheet-h"
          heading="Stub with details"
          submitLabel="Stub it"
          onCancel={onClose}
          onSubmit={(d) =>
            onSubmit(target, { watchedOn: d.watchedOn, watchedWhere: d.watchedWhere, note: d.note })
          }
        />
      )}
    </Sheet>
  );
}
