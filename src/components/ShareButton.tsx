'use client';
/**
 * Share (ADR-013 C-07): Web Share when the browser can share the payload, else copy the link ("Link
 * copied" toast), else a sheet with the link selected in a read-only field. The payload comes from
 * `shareData()` and only ever holds a title, a year and a rating: never a review body, a note or
 * spoiler text. Also the owner-only "Story image" action (C-08): share the PNG as a file, else download.
 */
import { useCallback, useId, useRef, useState } from 'react';
import { trackEvent, type ShareGeneratedEvent } from '@/lib/analytics';
import { BRAND_NAME } from '@/lib/brand';
import { storyHref } from '@/lib/routes';
import { shareData, type ShareData, type ShareTarget } from '@/lib/share';
import { useApp } from '@/hooks/useApp';
import { Icon } from './Icon';
import { shareTitle, type ShareTitle } from './lib/share-ref';
import { storyFileName } from './lib/display';
import { Sheet, SheetButtons, SheetSub, SheetTitle } from './Sheet';
import styles from './ShareButton.module.css';

type Surface = ShareGeneratedEvent['surface'];
export type { ShareTitle };
export { shareTitle };

function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  return env && /^https?:\/\//.test(env) ? env : window.location.origin;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/** The share flow: returns `share(target)` plus the fallback sheet to render once. */
export function useShare(surface: Surface) {
  const app = useApp();
  const [fallback, setFallback] = useState<ShareData | null>(null);

  const share = useCallback(
    async (target: ShareTarget) => {
      const data = shareData(target, siteUrl());
      const nav = typeof navigator === 'undefined' ? null : navigator;
      if (nav && typeof nav.share === 'function' && nav.canShare?.(data) !== false) {
        try {
          await nav.share(data);
          trackEvent('share_generated', { surface, method: 'native' });
          return;
        } catch (e) {
          if (isAbort(e)) return; // the user closed the share sheet
        }
      }
      try {
        if (!nav?.clipboard?.writeText) throw new Error('no clipboard');
        await nav.clipboard.writeText(data.url);
        app.toast({ message: 'Link copied' });
        trackEvent('share_generated', { surface, method: 'copy' });
      } catch {
        setFallback(data);
        trackEvent('share_generated', { surface, method: 'fallback' });
      }
    },
    [app, surface],
  );

  const sheet = <ShareFallback data={fallback} onClose={() => setFallback(null)} />;
  return { share, sheet };
}

function ShareFallback({ data, onClose }: { data: ShareData | null; onClose: () => void }) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Sheet open={data !== null} onClose={onClose} labelledBy={`${uid}-h`} testId="share-fallback">
      {data && (
        <>
          <SheetTitle id={`${uid}-h`}>Share link</SheetTitle>
          <SheetSub>Copy this link to share {data.title}.</SheetSub>
          <div className="field">
            <label htmlFor={`${uid}-url`}>Link</label>
            <input
              id={`${uid}-url`}
              ref={(el) => {
                input.current = el;
                el?.select();
              }}
              readOnly
              value={data.url}
              onFocus={(e) => e.currentTarget.select()}
              data-testid="share-fallback-url"
            />
          </div>
          <SheetButtons>
            <button type="button" className="btn btn--primary" onClick={onClose}>
              Done
            </button>
          </SheetButtons>
        </>
      )}
    </Sheet>
  );
}

export function ShareButton({
  target,
  surface,
  label,
  className = 'btn btn--ghost btn--sm',
}: {
  target: ShareTarget;
  surface: Surface;
  /** Accessible name: "Share {thing}". */
  label: string;
  className?: string;
}) {
  const { share, sheet } = useShare(surface);
  return (
    <>
      <button
        type="button"
        className={`${className} ${styles.btn}`}
        data-testid="share-button"
        aria-label={label}
        onClick={() => void share(target)}
      >
        <Icon name="share" size={16} />
        <span aria-hidden="true">Share</span>
      </button>
      {sheet}
    </>
  );
}

export { storyFileName };

/**
 * Owner-only "Story image" (C-08): share the 1080×1920 PNG as a file when the browser can, else
 * download it. Never throws; a failed fetch also falls back to the download link.
 */
export async function shareStory(stubId: string, number: number, title: string): Promise<void> {
  const download = () => {
    const a = document.createElement('a');
    a.href = storyHref(stubId, { download: true });
    a.download = storyFileName(number);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  try {
    const nav = navigator;
    if (
      typeof nav.share === 'function' &&
      typeof nav.canShare === 'function' &&
      typeof File !== 'undefined'
    ) {
      const res = await fetch(storyHref(stubId), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const file = new File([await res.blob()], storyFileName(number), { type: 'image/png' });
      if (nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: `${title} on ${BRAND_NAME}` });
        } catch (e) {
          if (!isAbort(e)) download();
          else return;
        }
        trackEvent('share_generated', { surface: 'stub', method: 'story' });
        return;
      }
    }
  } catch {
    /* fall through to the download */
  }
  download();
  trackEvent('share_generated', { surface: 'stub', method: 'story' });
}
