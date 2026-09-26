/**
 * Fonts are self-hosted (src/app/fonts/*.woff2, SIL OFL) via next/font/local so `next build` never
 * needs network access (ADR-001). next/font generates metric-matched fallbacks (size-adjust) → no CLS.
 * OWNER: Architect. FROZEN.
 */
import localFont from 'next/font/local';

/**
 * Bricolage ships as two subsets. They are separate families chained in --font-display
 * (latin first, then latin-ext), so glyphs such as "ō" in "Shōgun" fall through to the ext file.
 */
export const bricolage = localFont({
  src: './fonts/BricolageGrotesque-Latin-Variable.woff2',
  weight: '200 800',
  variable: '--font-bricolage',
  display: 'swap',
  // No fallback here: the variable must resolve to the bare family so the ext subset is tried next.
  fallback: [],
  adjustFontFallback: false,
});

export const bricolageExt = localFont({
  src: './fonts/BricolageGrotesque-LatinExt-Variable.woff2',
  weight: '200 800',
  variable: '--font-bricolage-ext',
  display: 'swap',
  preload: false,
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

export const geist = localFont({
  src: './fonts/Geist-Variable.woff2',
  weight: '100 900',
  variable: '--font-geist',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

export const geistMono = localFont({
  src: './fonts/GeistMono-Variable.woff2',
  weight: '100 900',
  variable: '--font-geist-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});

export const fontVariables = [bricolage, bricolageExt, geist, geistMono]
  .map((f) => f.variable)
  .join(' ');
