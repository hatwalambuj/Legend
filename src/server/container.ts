/**
 * Composition root: picks live vs demo implementations once per process from env().mode (ADR-006).
 * OWNER: Backend.
 */
import 'server-only';
import { env } from './env';
import type { Container } from './ports';
import { LocalAuthProvider } from './auth/local';
import { SupabaseAuthProvider } from './auth/supabase';
import { FixturesDetailProvider } from './providers/fixtures-detail';
import { NoRatingEnricher } from './providers/ratings';
import { TmdbDetailProvider } from './providers/tmdb';
import { MemoryCatalogIndex } from './repositories/memory/catalog';
import {
  MemoryProfiles,
  MemoryReviews,
  MemoryStubs,
  MemoryTitleStates,
  MemoryWatchlist,
} from './repositories/memory/user-data';
import {
  SupabaseCatalogIndex,
  SupabaseProfiles,
  SupabaseReviews,
  SupabaseStubs,
  SupabaseTitleStates,
  SupabaseWatchlist,
} from './repositories/supabase';

let instance: Container | null = null;

export function container(): Container {
  if (instance) return instance;
  const e = env();
  const live = e.mode.data === 'supabase';
  instance = {
    // Index follows DATA_MODE (catalog_index table vs fixtures); detail follows CATALOG_MODE.
    catalog: live ? new SupabaseCatalogIndex() : new MemoryCatalogIndex(),
    detail:
      e.mode.catalog === 'tmdb' && e.tmdb
        ? new TmdbDetailProvider(e.tmdb)
        : new FixturesDetailProvider(),
    ratings: new NoRatingEnricher(),
    auth: live ? new SupabaseAuthProvider() : new LocalAuthProvider(),
    profiles: live ? new SupabaseProfiles() : new MemoryProfiles(),
    stubs: live ? new SupabaseStubs() : new MemoryStubs(),
    reviews: live ? new SupabaseReviews() : new MemoryReviews(),
    watchlist: live ? new SupabaseWatchlist() : new MemoryWatchlist(),
    titleStates: live ? new SupabaseTitleStates() : new MemoryTitleStates(),
    sync: [],
  };
  return instance;
}

/** Tests only. */
export function resetContainer(): void {
  instance = null;
}
