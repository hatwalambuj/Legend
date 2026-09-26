/**
 * L2 detail cache over `public.title_detail_cache` (SYSTEM_DESIGN §4.3). Reads are public (RLS
 * `detail_read`); writes need the service role (revoked from API roles), so without
 * SUPABASE_SERVICE_ROLE_KEY `put` is a no-op. Purged after 150 days by the nightly job. OWNER: Backend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TitleKey } from '@/lib/types';
import type { DetailCacheStore, DetailResult } from '@/server/ports';

type ClientFn = () => SupabaseClient | Promise<SupabaseClient>;

export class SupabaseDetailCache implements DetailCacheStore {
  constructor(
    private readonly read: ClientFn,
    private readonly write: ClientFn | null,
  ) {}

  async get(key: TitleKey) {
    const db = await this.read();
    const { data, error } = await db
      .from('title_detail_cache')
      .select('payload, fetched_at, catalog_index!inner(title_key)')
      .eq('catalog_index.title_key', key)
      .maybeSingle();
    if (error) throw error;
    const row = data as { payload: Omit<DetailResult, 'stale'>; fetched_at: string } | null;
    if (!row?.payload?.fields) return null;
    return { result: row.payload, fetchedAt: row.fetched_at };
  }

  async put(key: TitleKey, result: Omit<DetailResult, 'stale'>, fetchedAt: string) {
    if (!this.write) return;
    const db = await this.write();
    const { data, error } = await db
      .from('catalog_index')
      .select('id')
      .eq('title_key', key)
      .maybeSingle();
    if (error) throw error;
    const id = (data as { id: number } | null)?.id;
    if (!id) return; // not in the index (yet): nothing to attach the payload to
    const res = await db
      .from('title_detail_cache')
      .upsert({ title_id: id, payload: result, fetched_at: fetchedAt }, { onConflict: 'title_id' });
    if (res.error) throw res.error;
  }
}
