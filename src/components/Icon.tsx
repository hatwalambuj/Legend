/** Inline SVG icons (no sprite request). Decorative by default: always pair with a visible or aria label. */
import type { SVGProps } from 'react';

export type IconName =
  | 'ticket'
  | 'plus'
  | 'check'
  | 'search'
  | 'home'
  | 'wallet'
  | 'user'
  | 'more'
  | 'bookmark'
  | 'star'
  | 'play'
  | 'ext'
  | 'eye'
  | 'eye-off'
  | 'alert'
  | 'close'
  | 'grid'
  | 'share';

const PATHS: Record<IconName, React.ReactNode> = {
  ticket: (
    <>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M3 7.5V5.8C3 5.4 3.4 5 3.8 5h16.4c.4 0 .8.4.8.8v1.7a2.5 2.5 0 0 0 0 5v1.7M3 7.5a2.5 2.5 0 0 1 0 5v5.7c0 .4.4.8.8.8h16.4c.4 0 .8-.4.8-.8v-4"
      />
      <path stroke="currentColor" strokeWidth="1.8" strokeDasharray="2 2.2" d="M15 5.5v13" />
    </>
  ),
  plus: <path stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" d="M12 5v14M5 12h14" />,
  check: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m5 12.5 4.5 4.5L19 7.5"
    />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="m20 20-3.5-3.5" />
    </>
  ),
  home: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"
    />
  ),
  wallet: (
    <>
      <rect
        x="3"
        y="6"
        width="18"
        height="14"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M7 6V4.5h10V6M16 13h2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"
      />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
    </>
  ),
  bookmark: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      d="M6.5 4h11v16l-5.5-4-5.5 4z"
    />
  ),
  star: (
    <path
      fill="currentColor"
      d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"
    />
  ),
  play: <path fill="currentColor" d="M8 5.5v13l10.5-6.5z" />,
  share: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 4v11M8 8l4-4 4 4M6 13v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5"
    />
  ),
  ext: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"
    />
  ),
  eye: (
    <>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
  'eye-off': (
    <>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
      />
      <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M4 4l16 16" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M12 7.5v5.5M12 16.5v.01"
      />
    </>
  ),
  close: (
    <path stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
  ),
  grid: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"
    />
  ),
};

export function Icon({
  name,
  size = 18,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Stubbed logo mark (ticket with perforation). */
export function LogoMark({ width = 30, height = 22 }: { width?: number; height?: number }) {
  return (
    <svg viewBox="0 0 30 22" width={width} height={height} aria-hidden="true" focusable="false">
      <path
        fill="var(--accent)"
        d="M3 0h24a3 3 0 0 1 3 3v5a3 3 0 0 0 0 6v5a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3v-5a3 3 0 0 0 0-6V3a3 3 0 0 1 3-3z"
      />
      <path stroke="var(--bg)" strokeWidth="1.6" strokeDasharray="2 2" d="M21 2v18" />
    </svg>
  );
}

/** Outline "ghost ticket" for empty states. */
export function GhostTicket() {
  return (
    <svg viewBox="0 0 30 22" width={64} height={44} aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="var(--fg-3)"
        strokeWidth="1.2"
        d="M3 .6h24A2.4 2.4 0 0 1 29.4 3v5a3 3 0 0 0 0 6v5a2.4 2.4 0 0 1-2.4 2.4H3A2.4 2.4 0 0 1 .6 19v-5a3 3 0 0 0 0-6V3A2.4 2.4 0 0 1 3 .6z"
      />
      <path stroke="var(--fg-3)" strokeDasharray="2 2" d="M21 2v18" />
    </svg>
  );
}
