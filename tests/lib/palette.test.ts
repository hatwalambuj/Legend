import { describe, expect, it } from 'vitest';
import catalogJson from '@/fixtures/catalog.json';
import type { FixtureCatalog } from '@/fixtures/schema';
import {
  clampY,
  contrastRatio,
  extractColors,
  hexToRgb,
  relativeLuminance,
  TINT1_MAX_Y,
  TINT2_MAX_Y,
} from '@/lib/palette';

const catalog = catalogJson as unknown as FixtureCatalog;

describe('palette (DESIGN §4.4 guard rail a)', () => {
  it('every fixture palette is clamped', () => {
    for (const t of catalog.titles) {
      expect(t.palette, t.key).not.toBeNull();
      expect(relativeLuminance(hexToRgb(t.palette!.tint1)), t.key).toBeLessThanOrEqual(TINT1_MAX_Y);
      expect(relativeLuminance(hexToRgb(t.palette!.tint2)), t.key).toBeLessThanOrEqual(TINT2_MAX_Y);
      expect(t.palette!.lqip).toMatch(/^data:image\/webp;base64,/);
    }
  });

  it('worst-case composite keeps --fg-2 at >= 4.5:1 (scrim 0.60 over tint + poster layer)', () => {
    // Linear-light worst case from DESIGN §4.4: Y <= 0.3*0.214 + 0.7*0.06 = 0.106, then 60% scrim of #0B0B0D.
    const bgY = relativeLuminance(hexToRgb('#0B0B0D'));
    const composite = 0.4 * (0.3 * 0.214 + 0.7 * TINT1_MAX_Y) + 0.6 * bgY;
    const fg2 = relativeLuminance(hexToRgb('#BDB8AE'));
    expect((fg2 + 0.05) / (composite + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('clampY keeps hue and darkens bright colours (e.g. Severance white)', () => {
    const c = clampY('#e8eef0', TINT2_MAX_Y);
    expect(relativeLuminance(hexToRgb(c))).toBeLessThanOrEqual(TINT2_MAX_Y);
    expect(contrastRatio(hexToRgb('#F4F1EA'), hexToRgb(c))).toBeGreaterThan(9);
  });

  it('extractColors picks the saturated bin over grey', () => {
    const px = new Uint8Array(24 * 36 * 3);
    for (let i = 0; i < px.length; i += 3) {
      const orange = i < px.length / 3;
      px[i] = orange ? 200 : 90;
      px[i + 1] = orange ? 100 : 90;
      px[i + 2] = orange ? 30 : 90;
    }
    const { vibrant } = extractColors(px);
    const [r, , b] = hexToRgb(vibrant);
    expect(r).toBeGreaterThan(b);
  });
});
