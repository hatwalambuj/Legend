/**
 * Diary (DESIGN §7.8): stubs grouped by month; each row is a horizontal ticket with the stub on the
 * right printing "#N STUB" (which watch this was). Owner rows get an Edit / Delete menu.
 */
import Link from 'next/link';
import { seasonLabel } from '@/lib/format';
import { titleHref } from '@/lib/routes';
import type { DiaryEntry } from '@/lib/types';
import { DiaryRowMenu } from './DiaryRowMenu';
import { formatDate, formatMonth, formatWeekday, kindLabel, whereLabel } from './lib/display';
import { Poster } from './Poster';
import { tintAttrs } from './Ticket';
import styles from './Diary.module.css';

export function DiaryRow({
  entry: e,
  editable = false,
}: {
  entry: DiaryEntry;
  editable?: boolean;
}) {
  const t = e.title;
  const where = whereLabel(e.watchedWhere);
  // ADR-013 C-10: "S03" for a season stub (null = the whole show).
  const season = t.mediaType === 'tv' ? seasonLabel(e.season) : '';
  return (
    <li className={styles.item}>
      <Link
        href={titleHref(t)}
        className={styles.row}
        data-testid="diary-row"
        aria-label={`${t.title}, ${kindLabel(t.mediaType).toLowerCase()}, ${season ? `season ${e.season}, ` : ''}watched ${formatDate(e.watchedOn)}, stub number ${e.number}${where ? `, ${where.toLowerCase()}` : ''}`}
        {...tintAttrs(t)}
      >
        <span className={styles.date} aria-hidden="true">
          <b>{e.watchedOn.slice(8, 10)}</b>
          {formatWeekday(e.watchedOn)}
        </span>
        <Poster
          title={t.title}
          posterPath={t.posterPath}
          palette={t.palette}
          genreIds={t.genres.map((g) => g.id)}
          size="w92"
          bare
          className={styles.thumb}
        />
        <span className={styles.t} aria-hidden="true">
          <b>{t.title}</b>
          <span>
            {kindLabel(t.mediaType)} · {t.year}
            {season && (
              <>
                {' · '}
                <span data-testid="diary-season">{season}</span>
              </>
            )}
            {e.number > 1 ? ' · Rewatch' : ''}
          </span>
        </span>
        <span className={styles.where} aria-hidden="true">
          {where}
          {e.note && <span className={styles.note}>{e.note}</span>}
        </span>
        <span className={styles.stub} aria-hidden="true">
          <b>#{e.number}</b>
          <span>STUB</span>
        </span>
      </Link>
      {editable && (
        <span className={styles.menu}>
          <DiaryRowMenu entry={e} />
        </span>
      )}
    </li>
  );
}

export function DiaryList({
  entries,
  editable = false,
}: {
  entries: DiaryEntry[];
  editable?: boolean;
}) {
  const months = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    const k = e.watchedOn.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), e]);
  }
  return (
    <div>
      {[...months.entries()].map(([k, list]) => (
        <section key={k} className={styles.month} aria-labelledby={`m-${k}`}>
          <h3 id={`m-${k}`}>
            {formatMonth(k)}
            <small>
              {list.length} stub{list.length === 1 ? '' : 's'}
            </small>
          </h3>
          <ul className={styles.list}>
            {list.map((e) => (
              <DiaryRow key={e.id} entry={e} editable={editable} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
