/**
 * Minimal ZIP reader (ADR-013 C-11): central directory, methods 0 (stored) and 8 (deflate, via the
 * platform's `DecompressionStream('deflate-raw')`). Rejects encryption and zip64. Bomb limits: <= 50
 * entries, each inflated entry <= 20 MB, total inflated <= 50 MB — counted while streaming, then
 * aborted. Pure and client-safe; no network. OWNER: Backend.
 */
import { ImportError, MAX_ENTRY_BYTES, MAX_TOTAL_INFLATED_BYTES, MAX_ZIP_ENTRIES } from './common';

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: MAX_ZIP_ENTRIES,
  maxEntryBytes: MAX_ENTRY_BYTES,
  maxTotalBytes: MAX_TOTAL_INFLATED_BYTES,
};

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  dataOffset: number;
}

export function isZip(data: Uint8Array): boolean {
  return (
    data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
  );
}

/** Central directory entries (no inflation). Throws ImportError on malformed/unsupported archives. */
export function listZip(data: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): ZipEntry[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u32 = (o: number) => v.getUint32(o, true);
  const u16 = (o: number) => v.getUint16(o, true);
  let eocd = -1;
  for (let o = data.length - 22; o >= Math.max(0, data.length - 22 - 0xffff); o--)
    if (u32(o) === 0x06054b50) {
      eocd = o;
      break;
    }
  if (eocd < 0) throw new ImportError('zip_invalid');
  if (eocd >= 20 && u32(eocd - 20) === 0x07064b50) throw new ImportError('zip64');
  const count = u16(eocd + 10);
  const cdSize = u32(eocd + 12);
  const cdOffset = u32(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    throw new ImportError('zip64');
  if (count > limits.maxEntries) throw new ImportError('zip_too_many_entries');
  if (cdOffset + cdSize > eocd) throw new ImportError('zip_invalid');
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length || u32(p) !== 0x02014b50) throw new ImportError('zip_invalid');
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const compressedSize = u32(p + 20);
    const size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const local = u32(p + 42);
    if (flags & 0x1) throw new ImportError('zip_encrypted');
    if (compressedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff)
      throw new ImportError('zip64');
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (local + 30 > data.length || u32(local) !== 0x04034b50) throw new ImportError('zip_invalid');
    const dataOffset = local + 30 + u16(local + 26) + u16(local + 28);
    if (dataOffset + compressedSize > data.length) throw new ImportError('zip_invalid');
    if (name.endsWith('/')) continue; // directory
    entries.push({ name, method, compressedSize, size, dataOffset });
  }
  return entries;
}

async function inflate(
  raw: Uint8Array,
  max: number,
  budget: { left: number },
): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      budget.left -= value.byteLength;
      if (size > max) throw new ImportError('zip_entry_too_large');
      if (budget.left < 0) throw new ImportError('zip_too_large');
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    if (e instanceof ImportError) throw e;
    throw new ImportError('zip_invalid');
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/**
 * Reads the entries `want` selects (default: every `.csv`), inflating with the limits above.
 * Returns name → bytes.
 */
export async function readZip(
  data: Uint8Array,
  want: (name: string) => boolean = (n) => /\.csv$/i.test(n),
  limits: ZipLimits = DEFAULT_LIMITS,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const budget = { left: limits.maxTotalBytes };
  for (const e of listZip(data, limits)) {
    if (!want(e.name)) continue;
    const raw = data.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
    if (e.method === 0) {
      if (raw.byteLength > limits.maxEntryBytes) throw new ImportError('zip_entry_too_large');
      budget.left -= raw.byteLength;
      if (budget.left < 0) throw new ImportError('zip_too_large');
      out.set(e.name, raw);
    } else if (e.method === 8) {
      out.set(e.name, await inflate(raw, limits.maxEntryBytes, budget));
    } else throw new ImportError('zip_method');
  }
  return out;
}

/** The basename of a ZIP path, lower-cased ("export/Diary.csv" → "diary.csv"). */
export const baseName = (path: string) => (path.split('/').pop() ?? path).toLowerCase();
