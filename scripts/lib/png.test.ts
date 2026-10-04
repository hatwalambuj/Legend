import { describe, expect, it } from 'vitest';
import { pngSize } from './png';

function header(width: number, height: number, type = 'IHDR'): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13);
  b.set(
    [...type].map((c) => c.charCodeAt(0)),
    12,
  );
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

describe('pngSize', () => {
  it('reads width and height from IHDR', () => {
    expect(pngSize(header(1200, 630))).toEqual({ width: 1200, height: 630 });
    expect(pngSize(header(1080, 1920))).toEqual({ width: 1080, height: 1920 });
  });
  it('works on a Buffer slice with an offset', () => {
    const big = Buffer.concat([Buffer.alloc(5), Buffer.from(header(10, 20))]);
    expect(pngSize(big.subarray(5))).toEqual({ width: 10, height: 20 });
  });
  it('rejects non-PNG, truncated and non-IHDR input', () => {
    expect(pngSize(new TextEncoder().encode('<html>not found</html> padding....'))).toBeNull();
    expect(pngSize(header(1, 1).slice(0, 20))).toBeNull();
    expect(pngSize(header(1, 1, 'IDAT'))).toBeNull();
  });
});
