/**
 * Live-mode repositories over Supabase (PostgREST + RPC, user JWT → RLS). OWNER: Backend. SKELETON.
 * Catalogue: call `rpc('catalog_page', …)` and `rpc('catalog_search', …)` (supabase/migrations) —
 * they implement the exact order/cursor semantics of src/lib/catalog-order.ts.
 * Map Postgres errors: P0001 'rate_limited' → AppError('rate_limited'), 23505 → conflict/handle_taken.
 */
import type {
  CatalogIndexRepository,
  ProfileRepository,
  ReviewRepository,
  StubRepository,
  TitleStateRepository,
  WatchlistRepository,
} from '@/server/ports';
import { notImplemented } from '../not-implemented';

const ni = (name: string) => () => notImplemented(`Supabase ${name}`);

export class SupabaseCatalogIndex implements CatalogIndexRepository {
  list = ni('catalog.list');
  trending = ni('catalog.trending');
  search = ni('catalog.search');
  get = ni('catalog.get');
  getMany = ni('catalog.getMany');
  count = ni('catalog.count');
  lastSyncAt = ni('catalog.lastSyncAt');
}
export class SupabaseProfiles implements ProfileRepository {
  getByHandle = ni('profiles.getByHandle');
  getById = ni('profiles.getById');
  stats = ni('profiles.stats');
  update = ni('profiles.update');
}
export class SupabaseStubs implements StubRepository {
  create = ni('stubs.create');
  update = ni('stubs.update');
  delete = ni('stubs.delete');
  get = ni('stubs.get');
  diary = ni('stubs.diary');
  wallet = ni('stubs.wallet');
  countRecent = ni('stubs.countRecent');
}
export class SupabaseReviews implements ReviewRepository {
  upsert = ni('reviews.upsert');
  delete = ni('reviews.delete');
  listForTitle = ni('reviews.listForTitle');
  listForUser = ni('reviews.listForUser');
  countRecent = ni('reviews.countRecent');
}
export class SupabaseWatchlist implements WatchlistRepository {
  add = ni('watchlist.add');
  remove = ni('watchlist.remove');
  list = ni('watchlist.list');
}
export class SupabaseTitleStates implements TitleStateRepository {
  states = ni('titleStates.states');
  stats = ni('titleStates.stats');
}
