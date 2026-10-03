/**
 * Demo-mode data store (ADR-006): plain JS arrays seeded from src/fixtures, persisted to a JSON file.
 * OWNER: Backend (skeleton by Architect).
 *
 * Design
 * - One process-wide instance on globalThis (survives Next dev HMR).
 * - Write-through: every mutation calls `commit()`, which writes `<dataDir>/db.json` atomically
 *   (write tmp + rename).
 * - Before each read `sync()` compares the file mtime and reloads if another worker/process wrote it,
 *   so separate module instances (route handlers vs RSC) never diverge.
 * - DEMO_PERSIST=memory → no file at all (unit tests). DEMO_RESET_ON_BOOT=true → reseed at first use (E2E).
 * - The catalogue is NOT persisted: it is always read from fixtures (read-only in demo mode).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import catalogJson from '@/fixtures/catalog.json';
import seedJson from '@/fixtures/seed.json';
import type { FixtureCatalog, FixtureSeed, FixtureStub, FixtureTitle } from '@/fixtures/schema';
import type { AvatarColor } from '@/lib/types';
import { env } from '@/server/env';

/** Seed users may get an avatar URL via profile edits, so widen `avatarUrl`. v1.6: `avatarColor`. */
export type DemoUser = Omit<FixtureSeed['users'][number], 'avatarUrl'> & {
  avatarUrl: string | null;
  avatarColor?: AvatarColor | null;
};

/**
 * Stub row. v1.6 additions are optional so seed rows and older data files still load: `season`
 * (ADR-013 C-10), `source` + `importKey` (C-11, mirror of `stubs.source` / `stubs.import_key`).
 */
export type DemoStub = FixtureStub & {
  season?: number | null;
  source?: 'app' | 'import';
  importKey?: string | null;
};

/** Owner-only per-user settings (mirror of `public.user_settings`, ADR-012 §3). */
export interface DemoSetting {
  userId: string;
  watchRegion: string | null;
  updatedAt: string;
}

export interface DemoData {
  version: 1;
  users: DemoUser[];
  stubs: DemoStub[];
  reviews: FixtureSeed['reviews'];
  watchlist: FixtureSeed['watchlist'];
  /** v1.5. Optional so data files written before it still load (treated as []). Seeded accounts have none. */
  settings?: DemoSetting[];
  /**
   * v1.6 (ADR-013 C-09): anonymous daily counters, `${day}|${name}|${dim}` → count (mirror of
   * `public.events`). Optional so older data files still load.
   */
  events?: Record<string, number>;
}

const catalog = catalogJson as unknown as FixtureCatalog;
const seed = seedJson as unknown as FixtureSeed;

export function fixtureTitles(): readonly FixtureTitle[] {
  return catalog.titles;
}

const seededEmails = new Set(seed.users.map((u) => u.email.toLowerCase()));
const seededIds = new Set(seed.users.map((u) => u.id));

/** The shared, well-known demo accounts from the seed (anyone may know their password). */
export function isSeededDemoUser(u: { email?: string; id?: string }): boolean {
  return (
    (u.email !== undefined && seededEmails.has(u.email.trim().toLowerCase())) ||
    (u.id !== undefined && seededIds.has(u.id))
  );
}

function freshData(): DemoData {
  // structuredClone so mutations never touch the imported JSON module.
  return structuredClone({
    version: 1 as const,
    users: seed.users,
    stubs: seed.stubs,
    reviews: seed.reviews,
    watchlist: seed.watchlist,
    settings: [] as DemoSetting[],
  });
}

class DemoStore {
  private data: DemoData;
  private mtimeMs = 0;
  private readonly file: string | null;

  constructor() {
    const { dataDir, resetOnBoot } = env().demo;
    this.file = dataDir ? join(dataDir, 'db.json') : null;
    if (this.file && !resetOnBoot && existsSync(this.file)) {
      this.data = this.readFile(this.file);
    } else {
      this.data = freshData();
      this.commit();
    }
  }

  /** Current data (reloaded from disk if another process changed it). */
  get(): DemoData {
    this.sync();
    return this.data;
  }

  /** Apply a mutation and persist. Keep mutators synchronous so they are atomic within the process. */
  mutate<T>(fn: (d: DemoData) => T): T {
    this.sync();
    const result = fn(this.data);
    this.commit();
    return result;
  }

  reset(): void {
    this.data = freshData();
    this.commit();
  }

  private sync(): void {
    if (!this.file) return;
    let m: number;
    try {
      m = statSync(this.file).mtimeMs;
    } catch {
      return; // file removed (e.g. `npm run demo:reset` while running): keep the in-memory copy
    }
    if (m !== this.mtimeMs) this.data = this.readFile(this.file);
  }

  /** A corrupt or foreign file never takes the demo down: fall back to the seed. */
  private readFile(file: string): DemoData {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DemoData>;
      this.mtimeMs = statSync(file).mtimeMs;
      if (
        parsed.version === 1 &&
        Array.isArray(parsed.users) &&
        Array.isArray(parsed.stubs) &&
        Array.isArray(parsed.reviews) &&
        Array.isArray(parsed.watchlist)
      )
        return parsed as DemoData;
    } catch (e) {
      console.error('[demo-store] unreadable data file, reseeding', e);
    }
    return freshData();
  }

  private commit(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
    this.mtimeMs = statSync(this.file).mtimeMs;
  }
}

const g = globalThis as unknown as { __stubbedDemoStore?: DemoStore };

export function demoStore(): DemoStore {
  g.__stubbedDemoStore ??= new DemoStore();
  return g.__stubbedDemoStore;
}

/** Tests only. */
export function resetDemoStoreSingleton(): void {
  g.__stubbedDemoStore = undefined;
}
