'use client';
/**
 * Poster with a mandatory generated fallback (ADR-007, DESIGN §3.3): the palette gradient is always
 * painted underneath, and the title is set in Bricolage over it whenever there is no image
 * (images off, no poster path, or the <img> failed). Never a broken-image icon.
 */
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { paletteOrDefault, posterFallbackStyle, tmdbImage, type PosterSize } from '@/lib/images';
import type { Palette } from '@/lib/types';
import { useApp } from '@/hooks/useApp';
import styles from './Poster.module.css';

const DIMENSIONS: Partial<Record<PosterSize, [number, number]>> = {
  w92: [92, 138],
  w154: [154, 231],
  w185: [185, 278],
  w342: [342, 513],
  w500: [500, 750],
};

export function Poster({
  title,
  posterPath,
  palette,
  genreIds = [],
  size = 'w342',
  alt = '',
  priority = false,
  bare = false,
  className = '',
}: {
  title: string;
  posterPath: string | null;
  palette: Palette | null;
  genreIds?: number[];
  size?: PosterSize;
  /** '' = decorative (the ticket link carries the name). */
  alt?: string;
  priority?: boolean;
  /** Thumbnails: no fallback title text. */
  bare?: boolean;
  className?: string;
}) {
  const { mode } = useApp();
  const src = tmdbImage(posterPath, size, mode.images);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const pal = paletteOrDefault(palette, genreIds);
  const [w, h] = DIMENSIONS[size] ?? [342, 513];

  // An image that failed before hydration never fires onError: check once on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  const showImage = Boolean(src) && !failed;
  return (
    <div
      className={`${styles.poster} ${className}`}
      style={posterFallbackStyle(pal)}
      role={alt && !showImage ? 'img' : undefined}
      aria-label={alt && !showImage ? alt : undefined}
      data-fallback={showImage ? undefined : 'true'}
    >
      {!showImage && !bare && (
        <span className={styles.fallbackTitle} aria-hidden="true">
          {title}
        </span>
      )}
      {showImage && src && (
        <Image
          ref={imgRef}
          src={src}
          alt={alt}
          width={w}
          height={h}
          className={styles.img}
          unoptimized
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          onError={() => setFailed(true)}
        />
      )}
      <i className={styles.fx} aria-hidden="true" />
    </div>
  );
}
