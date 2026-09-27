'use client';
/**
 * "Where to watch" region control (DESIGN §7.4.2 Region, PRD W3-AC3, ADR-012 §7).
 * - `WatchRegionSelect`: the ghost pill `[US ▾]` wrapping a native <select> (text code, no flag emoji).
 * - `WatchRegionSetting`: the Settings row (with "Automatic"), saved via `api.setWatchRegion`.
 */
import { forwardRef, useId, useState } from 'react';
import { api } from '@/lib/api-client';
import { regionName } from '@/lib/regions';
import { useApp } from '@/hooks/useApp';
import styles from './WatchRegionSelect.module.css';

export type RegionOption = { code: string; name: string };

/** Supported regions from `mode.watchRegions`; always contains `current` so the select never lies. */
export function useRegionOptions(current?: string | null): RegionOption[] {
  const { mode } = useApp();
  const list = mode.watchRegions ?? [];
  if (!current || list.some((r) => r.code === current)) return list;
  return [...list, { code: current, name: regionName(current) ?? current }];
}

export const WatchRegionSelect = forwardRef<
  HTMLSelectElement,
  {
    value: string;
    name: string;
    options: RegionOption[];
    onChange: (code: string) => void;
    disabled?: boolean;
  }
>(function WatchRegionSelect({ value, name, options, onChange, disabled = false }, ref) {
  return (
    <label className={styles.pill} data-testid="wtw-region">
      <span aria-hidden="true">{value}</span>
      <select
        ref={ref}
        value={value}
        disabled={disabled}
        aria-label={`Region: ${name}. Change region`}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {options.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name} · {r.code}
          </option>
        ))}
      </select>
    </label>
  );
});

/** Settings: "Where to watch region" with Automatic (null). `initial` = the server session's saved region. */
export function WatchRegionSetting({ initial }: { initial: string | null }) {
  const { toast } = useApp();
  const [value, setValue] = useState<string | null>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const options = useRegionOptions(value);
  const id = useId();

  async function save(next: string | null) {
    const prev = value;
    setValue(next);
    setSaving(true);
    setMsg(null);
    try {
      const res = await api.setWatchRegion(next);
      setValue(res.region);
      setMsg(
        res.region
          ? `Saved. Showing services in ${regionName(res.region) ?? res.region}.`
          : 'Saved. We pick your region automatically.',
      );
    } catch {
      setValue(prev);
      toast({ message: "Couldn't save your region. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.setting}>
      <label htmlFor={id} className={styles.label}>
        Where to watch region
      </label>
      <div className="select">
        <select
          id={id}
          value={value ?? ''}
          disabled={saving}
          aria-describedby={`${id}-hint`}
          data-testid="settings-watch-region"
          onChange={(e) => void save(e.currentTarget.value || null)}
        >
          <option value="">Automatic (from your browser)</option>
          {options.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name} · {r.code}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-hint`} className={styles.hint} aria-live="polite">
        {msg ?? 'Which country’s streaming services we show on title pages.'}
      </p>
    </div>
  );
}
