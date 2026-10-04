'use client';
/**
 * "Where to watch" provider tile + the 16px ticket-stub mark (DESIGN §7.4.2, ADR-012 §6.4, PRD W2/W5/W7).
 * Logos: TMDB `w92` via `providerLogoUrl()`, rendered 44×44 (16×16 for the mark), `alt=""` (the name is in
 * text). No logo, images off, or a failed load → a CSS monogram tile. Never a broken-image icon.
 */
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { providerLogoUrl } from '@/lib/images';
import type { WatchGroupType, WatchProviderItem } from '@/lib/types';
import { useApp } from '@/hooks/useApp';
import { Icon } from './Icon';
import { haptic } from './lib/motion';
import styles from './WhereToWatch.module.css';

/** Lower-case type words used in the tile's accessible name (W5-AC1). */
export const TYPE_WORD: Record<WatchGroupType, string> = {
  stream: 'stream',
  free: 'free',
  ads: 'free with ads',
  rent: 'rent',
  buy: 'buy',
  rent_buy: 'rent · buy',
};

/** "Open Netflix (stream) — opens in a new tab". */
export function providerTileName(name: string, type: WatchGroupType, alsoBuy = false): string {
  const word = type === 'rent' && alsoBuy ? TYPE_WORD.rent_buy : TYPE_WORD[type];
  return `Open ${name} (${word}) — opens in a new tab`;
}

function useLogo(path: string | null) {
  const { mode } = useApp();
  const src = providerLogoUrl(path, mode.images);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // A logo that failed before hydration never fires onError: check once on mount.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);
  return { src: failed ? null : src, ref, onError: () => setFailed(true) };
}

/** The 44×44 logo box (or a smaller mark via `className`); decorative. */
export function ProviderLogo({
  name,
  logoPath,
  monogram,
  tile,
  size = 44,
  className = styles.logo,
  children,
}: {
  name: string;
  logoPath: string | null;
  monogram: string;
  tile: string | null;
  size?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const { src, ref, onError } = useLogo(logoPath);
  const letter = monogram || [...name.trim()][0]?.toUpperCase() || '?';
  return (
    <span
      className={className}
      data-monogram={src ? undefined : ''}
      style={src ? undefined : { background: tile ?? 'var(--surface-2)' }}
      aria-hidden="true"
    >
      {src ? (
        <Image
          ref={ref}
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          unoptimized
          onError={onError}
        />
      ) : (
        <span className={styles.mono}>{letter}</span>
      )}
      {children}
    </span>
  );
}

export function ProviderTile({
  provider: p,
  type,
  region,
}: {
  provider: WatchProviderItem;
  type: WatchGroupType;
  region: string;
}) {
  return (
    <a
      className={styles.tile}
      href={p.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={providerTileName(p.name, type, p.alsoBuy)}
      title={`Open in ${p.name}`}
      data-testid={`wtw-provider-${p.providerId}`}
      data-link-kind={p.linkKind}
      onPointerDown={() => haptic(8)}
      // Fire-and-forget; never preventDefault, never await (W2-AC4).
      onClick={() =>
        trackEvent('provider_clicked', {
          provider_id: p.providerId,
          type,
          region,
          link_kind: p.linkKind,
        })
      }
    >
      <ProviderLogo name={p.name} logoPath={p.logoPath} monogram={p.monogram} tile={p.tile}>
        <span className={styles.ext} aria-hidden="true">
          <Icon name="ext" size={9} />
        </span>
      </ProviderLogo>
      <span className={styles.name}>{p.name}</span>
      {type === 'rent' && p.alsoBuy && <span className={styles.sub}>Rent · Buy</span>}
    </a>
  );
}

/** Stub-footer hint (W7-AC1): one decorative 16px logo, never a link. */
export function ProviderMark({
  name,
  logoPath,
  monogram,
  tile,
}: {
  name: string;
  logoPath: string | null;
  monogram: string;
  tile: string | null;
}) {
  return (
    <span
      className={styles.markWrap}
      aria-hidden="true"
      title={`On ${name}`}
      data-testid="ticket-providers"
    >
      <ProviderLogo
        name={name}
        logoPath={logoPath}
        monogram={monogram.slice(0, 2)}
        tile={tile}
        size={16}
        className={styles.mark}
      />
    </span>
  );
}
