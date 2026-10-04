/**
 * PNG header reader for the live smoke (AR-C5: OG 1200×630, story 1080×1920). Pure; no dependency.
 * Returns null unless `buf` starts with the PNG signature followed by an IHDR chunk.
 */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24 || SIGNATURE.some((b, i) => buf[i] !== b)) return null;
  // Bytes 12-15 = chunk type "IHDR"; 16-19 width, 20-23 height (big-endian).
  if (String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!) !== 'IHDR') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
