/**
 * Composition root: picks live vs demo implementations once per process from env().mode (ADR-006).
 * In demo mode no live provider is even constructed, so no server code path can reach the network.
 * OWNER: Backend.
 */
import 'server-only';
import { env } from './env';
import type { Container } from './ports';
import { LocalAuthProvider } from './auth/local';
import { SupabaseAuthProvider } from './auth/supabase';
import { FixturesDetailProvider } from './providers/fixtures-detail';
import { TmdbDetailProvider } from './providers/tmdb';
import { MemoryRateLimiter } from './rate-limit';
import { MemoryCatalogIndex, MemoryWatchProviders } from './repositories/memory/catalog';
import {
  MemoryEvents,
  MemoryImports,
  MemoryProfiles,
  MemoryReviews,
  MemorySettings,
  MemoryStubs,
  MemoryTitleStates,
  MemoryWatchlist,
} from './repositories/memory/user-data';
import {
  SupabaseCatalogIndex,
  SupabaseEvents,
  SupabaseImports,
  SupabaseProfiles,
  SupabaseRateLimiter,
  SupabaseReviews,
  SupabaseSettings,
  SupabaseStubs,
  SupabaseTitleStates,
  SupabaseWatchProviders,
  SupabaseWatchlist,
} from './repositories/supabase';
import { SupabaseDetailCache } from './repositories/supabase/detail-cache';
import { supabaseAdmin, supabasePublic } from './supabase/server';

let instance: Container | null = null;

export function container(): Container {
  if (instance) return instance;
  const e = env();
  const live = e.mode.data === 'supabase';
  const detailCache =
    live && e.supabase
      ? new SupabaseDetailCache(
          () => supabasePublic(),
          e.supabase.serviceRoleKey ? () => supabaseAdmin() : null,
        )
      : null;
  instance = {
    // Index follows DATA_MODE (catalog_index table vs fixtures); detail follows CATALOG_MODE.
    catalog: live ? new SupabaseCatalogIndex() : new MemoryCatalogIndex(),
    detail:
      e.mode.catalog === 'tmdb' && e.tmdb
        ? new TmdbDetailProvider(e.tmdb, { cache: detailCache })
        : new FixturesDetailProvider(),
    auth: live ? new SupabaseAuthProvider() : new LocalAuthProvider(),
    profiles: live ? new SupabaseProfiles() : new MemoryProfiles(),
    stubs: live ? new SupabaseStubs() : new MemoryStubs(),
    reviews: live ? new SupabaseReviews() : new MemoryReviews(),
    watchlist: live ? new SupabaseWatchlist() : new MemoryWatchlist(),
    titleStates: live ? new SupabaseTitleStates() : new MemoryTitleStates(),
    // Where to watch (ADR-012): provider names follow the index (DATA_MODE), like the watch data itself.
    watchProviders: live ? new SupabaseWatchProviders() : new MemoryWatchProviders(),
    settings: live ? new SupabaseSettings() : new MemorySettings(),
    rateLimiter: live ? new SupabaseRateLimiter() : new MemoryRateLimiter(),
    // v1.6 (ADR-013 C-09): anonymous counters; live writes need the service role (server only).
    events: live
      ? new SupabaseEvents(e.supabase?.serviceRoleKey ? () => supabaseAdmin() : null)
      : new MemoryEvents(),
    imports: live ? new SupabaseImports() : new MemoryImports(),
  };
  return instance;
}

/** Per-IP limiter for auth endpoints (best-effort per instance; Supabase Auth has its own limits). */
let authLimiter: MemoryRateLimiter | null = null;
export function authRateLimiter(): MemoryRateLimiter {
  authLimiter ??= new MemoryRateLimiter();
  return authLimiter;
}

/** Tests only. */
export function resetContainer(): void {
  instance = null;
  authLimiter = null;
}
