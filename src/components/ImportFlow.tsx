'use client';
/**
 * Import (ADR-013 C-11): pick a source → choose a .csv/.zip → parse in the browser (`detectAndParse`,
 * the file never leaves the device) → preview (server matches against our catalogue only, writes
 * nothing) → toggles → chunked commit (500 rows per call) → summary. TV Time is "beta" (format
 * unverified, ADR-013 §17 F11). OWNER: Frontend.
 */
import Link from 'next/link';
import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { BRAND_NAME } from '@/lib/brand';
import type { ImportCommitResponse, ImportPreviewResponse } from '@/lib/contracts';
import { detectAndParse, ImportError, type ParsedImport } from '@/lib/import';
import { profileHref } from '@/lib/routes';
import type { ImportSource } from '@/lib/types';
import styles from './ImportFlow.module.css';

export const IMPORT_CHUNK = 500;

const SOURCES: { value: ImportSource; label: string; hint: string; beta?: boolean }[] = [
  {
    value: 'letterboxd',
    label: 'Letterboxd',
    hint: 'Settings → Import & export → Export your data (.zip), or diary.csv. Our own export works too.',
  },
  { value: 'imdb', label: 'IMDb ratings', hint: 'Your ratings → ⋯ → Export (ratings.csv).' },
  { value: 'tvtime', label: 'TV Time', hint: 'Your GDPR data export (.zip).', beta: true },
];

type Phase =
  | { step: 'pick' }
  | { step: 'reading' }
  | { step: 'checking' }
  | { step: 'preview'; parsed: ParsedImport; preview: ImportPreviewResponse }
  | { step: 'importing'; done: number; total: number }
  | { step: 'summary'; result: ImportCommitResponse };

function errorText(e: unknown): string {
  if (e instanceof ImportError) return e.message;
  if (e instanceof ApiError) {
    if (e.code === 'payload_too_large')
      return 'That import is too big. Split the file and try again.';
    if (e.status === 429) return 'You’ve imported a lot today. Try again tomorrow.';
    return e.message;
  }
  return 'Something went wrong reading that file. Try again.';
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** "Download not imported (.csv)", built in the browser from the preview + parser skips. */
export function notImportedCsv(parsed: ParsedImport, preview: ImportPreviewResponse): string {
  const rows = [
    ...preview.unmatched.map((u) => [
      u.title,
      u.year ? String(u.year) : '',
      u.reason === 'invalid' ? 'invalid' : `not in ${BRAND_NAME}`,
    ]),
    ...parsed.skipped.map((s) => [s.title, s.year ? String(s.year) : '', 'invalid']),
  ];
  return ['Title,Year,Reason', ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

function addResults(a: ImportCommitResponse, b: ImportCommitResponse): ImportCommitResponse {
  return {
    created: {
      stubs: a.created.stubs + b.created.stubs,
      reviews: a.created.reviews + b.created.reviews,
    },
    skipped: {
      duplicate: a.skipped.duplicate + b.skipped.duplicate,
      notInStubbed: a.skipped.notInStubbed + b.skipped.notInStubbed,
      invalid: a.skipped.invalid + b.skipped.invalid,
      existingReview: a.skipped.existingReview + b.skipped.existingReview,
    },
  };
}

/** v4 uuid; `crypto.randomUUID` is missing outside secure contexts (plain-http LAN testing). */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const ZERO: ImportCommitResponse = {
  created: { stubs: 0, reviews: 0 },
  skipped: { duplicate: 0, notInStubbed: 0, invalid: 0, existingReview: 0 },
};

export function ImportFlow({ handle }: { handle: string }) {
  const uid = useId();
  const [source, setSource] = useState<ImportSource>('letterboxd');
  const [phase, setPhase] = useState<Phase>({ step: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState({ createStubs: true, ratings: true, reviews: true });
  const busy = phase.step === 'reading' || phase.step === 'checking' || phase.step === 'importing';

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhase({ step: 'reading' });
    try {
      const parsed = await detectAndParse(file);
      setSource(parsed.source);
      setPhase({ step: 'checking' });
      const preview = await api.importPreview({
        source: parsed.source,
        // Review bodies stay on the device until the commit (§5.26).
        rows: parsed.rows.map(({ review, ...r }) => (review ? { ...r, hasReview: true } : r)),
      });
      setPhase({ step: 'preview', parsed, preview });
    } catch (e) {
      setError(errorText(e));
      setPhase({ step: 'pick' });
    }
  }

  async function commit(parsed: ParsedImport) {
    setError(null);
    const importId = uuid();
    const chunks: ParsedImport['rows'][] = [];
    for (let i = 0; i < parsed.rows.length; i += IMPORT_CHUNK)
      chunks.push(parsed.rows.slice(i, i + IMPORT_CHUNK));
    if (chunks.length === 0) chunks.push([]);
    let total = ZERO;
    setPhase({ step: 'importing', done: 0, total: parsed.rows.length });
    try {
      for (let i = 0; i < chunks.length; i++) {
        const rows = chunks[i]!;
        const res = await api.importCommit({
          source: parsed.source,
          importId,
          final: i === chunks.length - 1,
          options: opts,
          rows,
        });
        total = addResults(total, res);
        setPhase({
          step: 'importing',
          done: Math.min(parsed.rows.length, (i + 1) * IMPORT_CHUNK),
          total: parsed.rows.length,
        });
      }
      setPhase({ step: 'summary', result: total });
    } catch (e) {
      // Committed chunks stay (re-uploading is idempotent); show what landed so far.
      setError(
        `${errorText(e)} Rows already imported are kept; upload the same file again to finish.`,
      );
      setPhase({ step: 'summary', result: total });
    }
  }

  function download(parsed: ParsedImport, preview: ImportPreviewResponse) {
    const url = URL.createObjectURL(
      new Blob([notImportedCsv(parsed, preview)], { type: 'text/csv' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'not-imported.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const picked = SOURCES.find((s) => s.value === source)!;

  return (
    <div className={styles.flow}>
      <p className={styles.privacy}>
        Your file stays on this device. We only send the matched titles, dates and ratings.
      </p>

      {error && (
        <p className={styles.error} role="alert" data-testid="import-error">
          {error}
        </p>
      )}

      {(phase.step === 'pick' || phase.step === 'reading' || phase.step === 'checking') && (
        <section className={styles.card} aria-labelledby={`${uid}-h1`}>
          <h2 id={`${uid}-h1`}>1. Where from?</h2>
          <fieldset className={styles.sources} disabled={busy}>
            <legend className="sr-only">Import source</legend>
            {SOURCES.map((s) => (
              <label key={s.value} className={styles.source}>
                <input
                  type="radio"
                  name={`${uid}-src`}
                  value={s.value}
                  checked={source === s.value}
                  onChange={() => setSource(s.value)}
                  data-testid={`import-source-${s.value}`}
                />
                <span>
                  {s.label}
                  {s.beta && <span className={styles.beta}>beta</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <p className={styles.hint} id={`${uid}-hint`}>
            {picked.hint}
            {picked.beta &&
              ' We haven’t seen many TV Time exports yet, so some rows may not match.'}
          </p>
          <h2 id={`${uid}-h2`}>2. Choose the file</h2>
          <label className={styles.file}>
            <span className="sr-only">Export file (.csv or .zip)</span>
            <input
              type="file"
              accept=".csv,.zip,text/csv,application/zip"
              aria-describedby={`${uid}-hint`}
              disabled={busy}
              onChange={(e) => void onFile(e.currentTarget.files?.[0])}
              data-testid="import-file"
            />
          </label>
          {busy && (
            <p className={styles.status} role="status">
              <progress aria-label="Reading the file" />{' '}
              {phase.step === 'reading'
                ? 'Reading the file on this device…'
                : `Matching titles in ${BRAND_NAME}…`}
            </p>
          )}
        </section>
      )}

      {phase.step === 'preview' && (
        <section className={styles.card} aria-labelledby={`${uid}-h3`} data-testid="import-preview">
          <h2 id={`${uid}-h3`}>3. Check it</h2>
          <p>
            {phase.parsed.label}: {phase.preview.counts.total} rows.
          </p>
          <dl className={styles.counts}>
            <div>
              <dt>Ready to import</dt>
              <dd data-testid="import-count-matched">{phase.preview.counts.matched}</dd>
            </div>
            <div>
              <dt>Already here</dt>
              <dd data-testid="import-count-duplicate">{phase.preview.counts.duplicate}</dd>
            </div>
            <div>
              <dt>Not in {BRAND_NAME}</dt>
              <dd data-testid="import-count-notin">{phase.preview.counts.notInStubbed}</dd>
            </div>
            <div>
              <dt>Unreadable</dt>
              <dd data-testid="import-count-invalid">
                {phase.preview.counts.invalid + phase.parsed.skipped.length}
              </dd>
            </div>
          </dl>
          {phase.preview.sample.length > 0 && (
            <ul className={styles.sample} aria-label="Some of the matched titles">
              {phase.preview.sample.slice(0, 10).map((s) => (
                <li key={s.ref}>
                  {s.title.title} ({s.title.year}){s.watchedOn ? ` · ${s.watchedOn}` : ''}
                  {s.rating10 ? ` · ${s.rating10}/10` : ''}
                </li>
              ))}
            </ul>
          )}
          {(phase.preview.unmatched.length > 0 || phase.parsed.skipped.length > 0) && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => download(phase.parsed, phase.preview)}
              data-testid="import-download-unmatched"
            >
              Download not imported (.csv)
            </button>
          )}
          <fieldset className={styles.opts}>
            <legend>What to bring in</legend>
            {(
              [
                ['createStubs', 'Create stubs (one per watch date)'],
                ['ratings', 'Ratings'],
                ['reviews', 'Reviews (never overwrites one you wrote here)'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={styles.opt}>
                <input
                  type="checkbox"
                  checked={opts[k]}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setOpts((o) => ({ ...o, [k]: on }));
                  }}
                  data-testid={`import-opt-${k}`}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className={styles.row}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={phase.preview.counts.matched === 0}
              onClick={() => void commit(phase.parsed)}
              data-testid="import-commit"
            >
              Import {phase.preview.counts.matched}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setPhase({ step: 'pick' })}
            >
              Choose another file
            </button>
          </div>
        </section>
      )}

      {phase.step === 'importing' && (
        <section className={styles.card} aria-labelledby={`${uid}-h4`}>
          <h2 id={`${uid}-h4`}>Importing…</h2>
          <progress
            max={phase.total || 1}
            value={phase.done}
            aria-label="Import progress"
            data-testid="import-progress"
          />
          <p role="status">
            {phase.done} of {phase.total} rows
          </p>
        </section>
      )}

      {phase.step === 'summary' && (
        <section className={styles.card} aria-labelledby={`${uid}-h5`} data-testid="import-summary">
          <h2 id={`${uid}-h5`}>Done</h2>
          <p role="status">
            {phase.result.created.stubs} stub{phase.result.created.stubs === 1 ? '' : 's'} and{' '}
            {phase.result.created.reviews} review{phase.result.created.reviews === 1 ? '' : 's'}{' '}
            added.
            {phase.result.skipped.duplicate > 0 &&
              ` ${phase.result.skipped.duplicate} already here.`}
            {phase.result.skipped.existingReview > 0 &&
              ` ${phase.result.skipped.existingReview} reviews kept as you wrote them.`}
          </p>
          <div className={styles.row}>
            <Link
              className="btn btn--primary"
              href={`${profileHref(handle)}?tab=diary`}
              data-testid="import-diary-link"
            >
              See your diary
            </Link>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setPhase({ step: 'pick' })}
            >
              Import another file
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
