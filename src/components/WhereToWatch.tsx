'use client';
/**
 * "Where to watch" block (DESIGN §7.4.2, PRD §13 W1–W5, ADR-012). First paint is SSR from
 * `TitleDetail.watch` (the page skips this component when it is null, so there is no CLS). The region
 * pill swaps the list in place via `api.titleWatch`, persists via `api.setWatchRegion` (cookie, plus the
 * profile when signed in) and mirrors the choice into the URL (`?region=GB`).
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { JUSTWATCH_ATTRIBUTION } from '@/lib/provider-links';
import { regionName } from '@/lib/regions';
import type { TitleWatch, WatchGroup, WatchGroupType } from '@/lib/types';
import { useApp, useTitleState, type StubTarget } from '@/hooks/useApp';
import { DEGRADED_DESC_ID } from './DegradedBanner';
import { Icon } from './Icon';
import { formatDate } from './lib/display';
import { ProviderTile } from './ProviderTile';
import { useRegionOptions, WatchRegionSelect } from './WatchRegionSelect';
import styles from './WhereToWatch.module.css';

/** Cap per group before "+N" (W1-AC3). */
export const WTW_CAP = 6;
/** Region-switch budget (DESIGN §7.4.2 States: error / timeout 1.5 s). */
export const WTW_TIMEOUT_MS = 1500;

export const GROUP_LABEL: Record<WatchGroupType, string> = {
  stream: 'Stream',
  free: 'Free',
  ads: 'Free with ads',
  rent: 'Rent',
  buy: 'Buy',
  rent_buy: 'Rent · Buy',
};

/** Test id per DESIGN §11: a merged Rent · Buy group keeps the `rent` id. */
function groupTestId(type: WatchGroupType): string {
  return `wtw-group-${type === 'rent_buy' ? 'rent' : type}`;
}

/** "the US" / "the UK" read naturally in the empty line; other regions use their name. */
export function regionPhrase(code: string, name: string): string {
  if (code === 'US') return 'the US';
  if (code === 'GB') return 'the UK';
  return name;
}

type Status = 'ready' | 'loading' | 'error';

export function WhereToWatch({
  initial,
  target,
  paused = false,
}: {
  initial: TitleWatch;
  target: StubTarget;
  paused?: boolean;
}) {
  const app = useApp();
  const [data, setData] = useState<TitleWatch | null>(initial);
  const [region, setRegion] = useState(initial.region);
  const [status, setStatus] = useState<Status>('ready');
  const selectRef = useRef<HTMLSelectElement>(null);
  const reqRef = useRef<{ id: number; ctrl: AbortController | null }>({ id: 0, ctrl: null });
  const healedRef = useRef(false);
  const options = useRegionOptions(region);
  const name = regionName(region) ?? region;

  const load = useCallback(
    async (code: string) => {
      reqRef.current.ctrl?.abort();
      const ctrl = new AbortController();
      const id = ++reqRef.current.id;
      reqRef.current.ctrl = ctrl;
      const timer = setTimeout(() => ctrl.abort(), WTW_TIMEOUT_MS);
      setStatus('loading');
      try {
        const res = await api.titleWatch(target.key, code, { signal: ctrl.signal });
        if (id !== reqRef.current.id) return;
        setData(res.watch);
        setStatus('ready');
      } catch {
        if (id !== reqRef.current.id) return;
        setStatus('error');
      } finally {
        clearTimeout(timer);
      }
    },
    [target.key],
  );

  useEffect(() => () => reqRef.current.ctrl?.abort(), []);

  const change = useCallback(
    (code: string, { persist = true }: { persist?: boolean } = {}) => {
      healedRef.current = true;
      setRegion(code);
      void load(code);
      if (persist) api.setWatchRegion(code).catch(() => {});
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('region', code);
        window.history.replaceState(null, '', url);
      } catch {
        /* URL sync is an enhancement */
      }
    },
    [load],
  );

  // ADR-012 §7 cookie heal: the profile has a region but SSR didn't see the cookie (e.g. signed in on
  // another device). Only when SSR had no explicit choice (?region or cookie), so a fresh Settings
  // change is never reverted by a stale session.
  const saved = app.session?.user.watchRegion ?? null;
  useEffect(() => {
    if (healedRef.current || !app.sessionReady) return;
    healedRef.current = true;
    if (!saved || saved === initial.region) return;
    if (initial.source === 'query' || initial.source === 'setting') return;
    if (!options.some((o) => o.code === saved)) return;
    const before = reqRef.current.id;
    void api
      .setWatchRegion(saved)
      .catch(() => null)
      // Skip if the user already switched while the cookie was being healed.
      .then(() => {
        if (reqRef.current.id === before) change(saved, { persist: false });
      });
  }, [app.sessionReady, saved, initial.region, initial.source, options, change]);

  const openPicker = () => {
    const el = selectRef.current;
    if (!el) return;
    el.focus();
    try {
      el.showPicker?.();
    } catch {
      /* not supported or not allowed: focus is enough */
    }
  };

  if (!data && status === 'ready') return null;

  const show = data && status === 'ready' ? data : null;
  return (
    <section
      className={`glass ${styles.wtw}`}
      data-testid="where-to-watch"
      aria-labelledby="wtw-h"
      aria-busy={status === 'loading' || undefined}
      data-region={region}
    >
      <div className={styles.h}>
        <h2 className="eyebrow" id="wtw-h">
          Where to watch
        </h2>
        <WatchRegionSelect
          ref={selectRef}
          value={region}
          name={name}
          options={options}
          onChange={(code) => change(code)}
        />
      </div>
      {show?.fallback && (
        <p className={styles.fallback} data-testid="wtw-fallback">
          Showing: {show.regionName} ·{' '}
          <button type="button" className="text-btn" onClick={openPicker}>
            Change
          </button>
        </p>
      )}

      {status === 'loading' && (
        <div className={styles.sk} data-testid="wtw-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      {status === 'loading' && <span className="sr-only">Loading services for {name}…</span>}

      {status === 'error' && (
        <p className={styles.error} data-testid="wtw-error" role="status">
          Couldn&apos;t load where to watch.{' '}
          <button type="button" className="text-btn" onClick={() => void load(region)}>
            Retry
          </button>
        </p>
      )}

      {show?.status === 'none' && (
        <EmptyRow
          phrase={regionPhrase(show.region, show.regionName)}
          target={target}
          paused={paused}
          onChangeRegion={openPicker}
        />
      )}
      {show?.status === 'available' && <Rail watch={show} />}

      {status !== 'error' && data && (
        <div className={styles.foot}>
          <span className={styles.attr} data-testid="wtw-checked">
            Checked {formatDate(data.checkedAt)} · Availability can change
          </span>
          <a
            className={styles.all}
            href={data.allOptionsHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="wtw-all-options"
          >
            All options
            <Icon name="ext" size={12} />
            <span className="sr-only"> for {data.regionName} on TMDB — opens in a new tab</span>
          </a>
        </div>
      )}
      <p className={`${styles.attr} ${styles.jw}`} data-testid="wtw-attribution">
        Data by{' '}
        <a href={JUSTWATCH_ATTRIBUTION.href} target="_blank" rel={JUSTWATCH_ATTRIBUTION.rel}>
          JustWatch
          <span className="sr-only"> — opens in a new tab</span>
        </a>
      </p>
    </section>
  );
}

function Rail({ watch }: { watch: TitleWatch }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [watch]);

  return (
    <div className={styles.rail} ref={railRef} data-overflow={overflow || undefined}>
      {watch.groups.map((g) => (
        <Group key={g.type} group={g} region={watch.region} />
      ))}
    </div>
  );
}

function Group({ group, region }: { group: WatchGroup; region: string }) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const focusNext = useRef(false);
  const hid = useId();
  const label = GROUP_LABEL[group.type];
  const extra = group.providers.length - WTW_CAP;
  const shown = expanded || extra <= 0 ? group.providers : group.providers.slice(0, WTW_CAP);

  useEffect(() => {
    if (!expanded || !focusNext.current) return;
    focusNext.current = false;
    listRef.current?.querySelectorAll<HTMLAnchorElement>('a')[WTW_CAP]?.focus();
  }, [expanded]);

  return (
    <div className={styles.group} data-testid={groupTestId(group.type)} data-type={group.type}>
      <span className={styles.groupL} id={hid}>
        {label}
      </span>
      <ul role="list" aria-labelledby={hid} ref={listRef}>
        {shown.map((p) => (
          <li key={p.providerId}>
            <ProviderTile provider={p} type={group.type} region={region} />
          </li>
        ))}
        {!expanded && extra > 0 && (
          <li>
            <button
              type="button"
              className={`${styles.tile} ${styles.more}`}
              data-testid="wtw-more"
              aria-label={`Show ${extra} more ${label} options`}
              onClick={() => {
                focusNext.current = true;
                setExpanded(true);
              }}
            >
              <span className={styles.logo} aria-hidden="true">
                +{extra}
              </span>
              <span className={styles.name} aria-hidden="true">
                More
              </span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function EmptyRow({
  phrase,
  target,
  paused,
  onChangeRegion,
}: {
  phrase: string;
  target: StubTarget;
  paused: boolean;
  onChangeRegion: () => void;
}) {
  const app = useApp();
  const state = useTitleState(target.key);
  const watchlisted = state?.watchlisted ?? false;
  return (
    <div className={styles.empty} data-testid="wtw-empty">
      <p>
        <b>Not streaming in {phrase} right now.</b>
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onChangeRegion}>
        Change region
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-pressed={watchlisted}
        data-testid="wtw-watchlist"
        {...(paused
          ? { 'aria-disabled': true as const, 'aria-describedby': DEGRADED_DESC_ID }
          : {})}
        onClick={() => {
          if (!paused) void app.toggleWatchlist(target);
        }}
      >
        <Icon name={watchlisted ? 'check' : 'bookmark'} size={16} />
        <span>{watchlisted ? 'On watchlist' : 'Add to Watchlist'}</span>
      </button>
    </div>
  );
}

/** Same frame as the block with 4 skeleton tiles; for route-level loading states. */
export function WhereToWatchSkeleton() {
  return (
    <div className={`glass ${styles.wtw}`} aria-hidden="true">
      <div className={styles.h}>
        <span className="eyebrow">Where to watch</span>
      </div>
      <div className={styles.sk} data-testid="wtw-skeleton">
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
