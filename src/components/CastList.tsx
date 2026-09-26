'use client';
/** Top cast (DESIGN §7.4): horizontal scroll of 6, TMDB w185 profile or initials fallback. */
import Image from 'next/image';
import { useState } from 'react';
import { tmdbImage } from '@/lib/images';
import type { CastMember } from '@/lib/types';
import { useApp } from '@/hooks/useApp';
import { initials } from './lib/display';
import styles from './CastList.module.css';

function Face({ person }: { person: CastMember }) {
  const { mode } = useApp();
  const src = tmdbImage(person.profilePath, 'w185', mode.images);
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.ph} aria-hidden="true">
      {src && !failed ? (
        <Image
          src={src}
          alt=""
          width={64}
          height={64}
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

export function CastList({ cast }: { cast: CastMember[] }) {
  if (!cast.length) return null;
  return (
    <section aria-labelledby="cast-h">
      <h2 id="cast-h" className={`eyebrow ${styles.h}`}>
        Top cast
      </h2>
      <ul className={styles.cast}>
        {cast.slice(0, 6).map((c) => (
          <li key={`${c.name}-${c.character}`}>
            <Face person={c} />
            <span className={styles.name}>{c.name}</span>
            {c.character && <span className={styles.role}>{c.character}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
