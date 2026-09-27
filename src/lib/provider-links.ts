/**
 * "Where to watch" link config and builder (ADR-012 §6.3). Versioned, client-safe, OWNER: Architect
 * (landed by backend in W-00). Changing an entry needs an ADR-012 table update first.
 *
 * Rules (security checklist ADR-012 §10.1, PRD W2 / W8-AC2)
 * - No `href` ever comes from upstream data. Tiles link to a template below or to `tmdbWatchHref()`.
 *   The TMDB `link` string in the API response is never rendered.
 * - Every URL is plain `https:` on an allowlisted host (exact match), no credentials, no port, no
 *   custom scheme, no affiliate/UTM/tracking parameter. A template that fails any check falls back to
 *   the TMDB watch page (`kind: 'tmdb'`).
 * - The title is trimmed, cut to 100 chars and `encodeURIComponent`-ed into exactly one `{title}` slot
 *   (a query value or one path segment). No user data, region cookie or session ever goes into a URL.
 * - Every template is Unverified until QA's device check (W2-AC5); a failing one is deleted, leaving `home`.
 * Provider ids are TMDB's (Inferred, ADR-012 §6.3); the weekly provider-list sync logs config ids TMDB
 * does not return.
 */
import type { MediaType } from './types';

export const PROVIDER_LINKS_VERSION = '2026-09-27.1';

export interface ProviderLink {
  /** https homepage, required. */
  home: string;
  /** https template with exactly one `{title}`, in a query value or one path segment. */
  search?: string;
  /** Regional storefronts (e.g. Amazon Video in GB/IN). */
  byRegion?: Partial<Record<string, { home: string; search?: string }>>;
  /** <= 2 chars for the demo / no-logo tile. */
  monogram?: string;
  /** Tile background for the monogram (demo / no-logo). */
  tile?: `#${string}`;
}

const netflix: ProviderLink = {
  home: 'https://www.netflix.com/',
  search: 'https://www.netflix.com/search?q={title}',
  monogram: 'N',
  tile: '#b20710',
};
const primeVideo: ProviderLink = {
  home: 'https://www.primevideo.com/',
  search: 'https://www.primevideo.com/search/?phrase={title}',
  monogram: 'pv',
  tile: '#0f79af',
};
const appleTv: ProviderLink = {
  home: 'https://tv.apple.com/',
  search: 'https://tv.apple.com/search?term={title}',
  monogram: 'tv',
  tile: '#1c1c1e',
};
const hotstar: ProviderLink = { home: 'https://www.hotstar.com/', monogram: 'JH', tile: '#1f2a6b' };

export const PROVIDER_LINKS: Readonly<Record<number, ProviderLink>> = {
  8: netflix, // Netflix
  1796: netflix, // Netflix basic with Ads
  9: primeVideo, // Amazon Prime Video
  119: primeVideo, // Amazon Prime Video (IN and others)
  10: {
    // Amazon Video (store)
    home: 'https://www.amazon.com/',
    byRegion: { GB: { home: 'https://www.amazon.co.uk/' }, IN: { home: 'https://www.amazon.in/' } },
    monogram: 'a',
    tile: '#232f3e',
  },
  337: { home: 'https://www.disneyplus.com/', monogram: 'D+', tile: '#113ccf' }, // Disney Plus
  1899: { home: 'https://www.hbomax.com/', monogram: 'M', tile: '#002be7' }, // Max / HBO Max
  15: { home: 'https://www.hulu.com/', monogram: 'h', tile: '#0b7a47' }, // Hulu
  350: appleTv, // Apple TV+
  2: appleTv, // Apple TV (store)
  3: {
    // Google Play Movies
    home: 'https://play.google.com/store/movies',
    search: 'https://play.google.com/store/search?q={title}&c=movies',
    monogram: 'G',
    tile: '#01875f',
  },
  531: { home: 'https://www.paramountplus.com/', monogram: 'P+', tile: '#0064ff' }, // Paramount Plus
  386: { home: 'https://www.peacocktv.com/', monogram: 'P', tile: '#2b2b2b' }, // Peacock
  73: {
    // Tubi
    home: 'https://tubitv.com/',
    search: 'https://tubitv.com/search/{title}',
    monogram: 'T',
    tile: '#5a1ec8',
  },
  300: { home: 'https://pluto.tv/', monogram: 'PL', tile: '#3b3b3b' }, // Pluto TV
  38: {
    // BBC iPlayer
    home: 'https://www.bbc.co.uk/iplayer',
    search: 'https://www.bbc.co.uk/iplayer/search?q={title}',
    monogram: 'iP',
    tile: '#b0004d',
  },
  39: { home: 'https://www.nowtv.com/', monogram: 'NW', tile: '#00717a' }, // NOW
  2336: hotstar, // JioHotstar
  122: hotstar, // Hotstar (legacy id)
  192: {
    // YouTube
    home: 'https://www.youtube.com/',
    search: 'https://www.youtube.com/results?search_query={title}',
    monogram: 'YT',
    tile: '#b00000',
  },
};

/** Query keys that mark affiliate / campaign / click tracking (W8-AC2). */
export const BANNED_QUERY_KEY = /^(utm_|tag$|affid|aff_|ref$|ref_|campaign|clickid|gclid|fbclid)/i;

const TMDB_WATCH_HOST = 'www.themoviedb.org';

function hostOf(url: string): string | null {
  try {
    return new URL(url.replace('{title}', 'x')).host;
  } catch {
    return null;
  }
}

/** Exact hosts of every configured URL, derived at module load. */
export const PROVIDER_LINK_HOSTS: ReadonlySet<string> = new Set(
  Object.values(PROVIDER_LINKS).flatMap((p) =>
    [p, ...Object.values(p.byRegion ?? {})]
      .flatMap((e) => (e ? [e.home, e.search] : []))
      .filter((u): u is string => typeof u === 'string')
      .map(hostOf)
      .filter((h): h is string => h !== null),
  ),
);

/** "All options" and the fallback tile link: TMDB's watch page for the title and region (ours, derived). */
export function tmdbWatchHref(mediaType: MediaType, tmdbId: number, region: string): string {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const id = Number.isInteger(tmdbId) && tmdbId > 0 ? tmdbId : 0;
  const locale = /^[A-Z]{2}$/.test(region) ? region : 'US';
  return `https://${TMDB_WATCH_HOST}/${type}/${id}/watch?locale=${locale}`;
}

/** True when `href` passes every link rule for a provider URL (https, allowlisted host, no tracking). */
export function isSafeProviderUrl(href: string, hosts: ReadonlySet<string> = PROVIDER_LINK_HOSTS) {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  if (!hosts.has(u.host)) return false;
  for (const key of u.searchParams.keys()) if (BANNED_QUERY_KEY.test(key)) return false;
  return true;
}

/** The title as it goes into a `{title}` slot; null when nothing usable is left. */
function encodedTitle(title: string): string | null {
  const t = title.trim().slice(0, 100).trim();
  if (!t) return null;
  const enc = encodeURIComponent(t);
  // "." / ".." in a path slot would be resolved as a dot segment by the URL parser.
  return /^\.+$/.test(enc) ? null : enc;
}

/**
 * The link of one provider tile. Picks the regional storefront when configured, the search template
 * with the title when there is one, else the homepage; anything that fails `isSafeProviderUrl` (or an
 * unknown provider id) becomes the TMDB watch page.
 */
export function providerHref(
  providerId: number,
  title: string,
  region: string,
  mediaType: MediaType,
  tmdbId: number,
): { href: string; kind: 'search' | 'home' | 'tmdb' } {
  const fallback = { href: tmdbWatchHref(mediaType, tmdbId, region), kind: 'tmdb' as const };
  const cfg = PROVIDER_LINKS[providerId];
  if (!cfg) return fallback;
  const entry = cfg.byRegion?.[region] ?? cfg;
  const enc = entry.search ? encodedTitle(title) : null;
  if (entry.search && enc !== null && entry.search.split('{title}').length === 2) {
    const href = entry.search.replace('{title}', enc);
    if (isSafeProviderUrl(href)) return { href, kind: 'search' };
  }
  return isSafeProviderUrl(entry.home) ? { href: entry.home, kind: 'home' } : fallback;
}

/** Monogram + tile for a provider without a logo (config first, then the first letter of the name). */
export function providerMonogram(
  providerId: number,
  name: string,
): { monogram: string; tile: string | null } {
  const cfg = PROVIDER_LINKS[providerId];
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?';
  return { monogram: (cfg?.monogram ?? letter).slice(0, 2), tile: cfg?.tile ?? null };
}

/** TMDB's attribution rule for watch-provider data (ADR-012 §6.4, PRD W1-AC4). */
export const JUSTWATCH_ATTRIBUTION = {
  text: 'Data by JustWatch',
  href: 'https://www.justwatch.com/',
  rel: 'noopener noreferrer',
} as const;
