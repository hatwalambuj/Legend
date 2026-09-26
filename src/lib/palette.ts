/**
 * Colour maths for poster palettes (DESIGN §4.2 / §4.4). Pure and isomorphic.
 * Used by: the nightly sync job (with sharp), the fixture builder, and contrast unit tests.
 * OWNER: Architect. FROZEN.
 */

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance, 0..1. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 0..1 chroma approximation (max-min of sRGB channels). */
export function chroma([r, g, b]: Rgb): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Darken by multiplying RGB by 0.9 until luminance <= maxY. Keeps hue (DESIGN §4.2 step 4). */
export function clampY(hex: string, maxY: number): string {
  let rgb = hexToRgb(hex);
  // Check the ROUNDED colour each step: rounding up after the loop could push Y back over maxY.
  for (let i = 0; i < 64 && relativeLuminance(rgb) > maxY; i++) {
    rgb = hexToRgb(rgbToHex([rgb[0] * 0.9, rgb[1] * 0.9, rgb[2] * 0.9]));
  }
  return rgbToHex(rgb);
}

export const TINT1_MAX_Y = 0.06;
export const TINT2_MAX_Y = 0.02;

/** Build the stored tints from the two extracted colours. */
export function tintsFrom(vibrant: string, base: string): { tint1: string; tint2: string } {
  return { tint1: clampY(vibrant, TINT1_MAX_Y), tint2: clampY(base, TINT2_MAX_Y) };
}

/**
 * Extract { vibrant, base } from raw RGB pixels (24x36 poster, 3 bytes/pixel) — the DESIGN §4.2
 * histogram algorithm. Isomorphic: the sync job feeds it `sharp(...).raw()` output.
 */
export function extractColors(pixels: Uint8Array | Buffer): { vibrant: string; base: string } {
  const bins = new Map<number, { w: number; r: number; g: number; b: number }>();
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let i = 0; i + 2 < pixels.length; i += 3) {
    const rgb: Rgb = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    sr += rgb[0];
    sg += rgb[1];
    sb += rgb[2];
    n++;
    const y = relativeLuminance(rgb);
    if (y < 0.02 || y > 0.9) continue;
    const key = ((rgb[0] >> 4) << 8) | ((rgb[1] >> 4) << 4) | (rgb[2] >> 4);
    const w = 0.3 + chroma(rgb);
    const e = bins.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
    e.w += w;
    e.r += rgb[0] * w;
    e.g += rgb[1] * w;
    e.b += rgb[2] * w;
    bins.set(key, e);
  }
  const base: Rgb = n ? [sr / n, sg / n, sb / n] : [42, 42, 51];
  const top = [...bins.values()].sort((a, b) => b.w - a.w)[0];
  const vibrant: Rgb = top ? [top.r / top.w, top.g / top.w, top.b / top.w] : base;
  return { vibrant: rgbToHex(vibrant), base: rgbToHex(base) };
}
