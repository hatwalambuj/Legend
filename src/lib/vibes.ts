/**
 * Vibe mapping table for the "Worth it?" block (PRD §4.2 line 2, F1-AC5). Versioned config we own.
 * OWNER: Backend (tuning the table and weights) — reference table authored by Architect.
 * Pure and isomorphic. Deterministic: genres + an ALLOWLIST of TMDB keyword names → up to 3 tags.
 * No AI/LLM, ever (D15).
 *
 * Rules
 * - Only keywords listed in KEYWORD_VIBES can produce a tag. Unknown keywords are ignored.
 * - Never add a keyword that can spoil (twists, deaths, reveals, endings). tests/lib/worth-it.test.ts
 *   rejects any allowlisted keyword that matches SPOILER_PATTERNS.
 * - Keywords are TMDB keyword *names*, lowercased and trimmed (stable and reviewable; ids can be added).
 * - Bump VIBE_MAPPING_VERSION whenever the table changes meaningfully (it is shown nowhere, but logged).
 */
import type { MediaType, Vibe, VibeId } from './types';

export const VIBE_MAPPING_VERSION = 1;

/** Display order is also the tie-break order. Labels are <= 18 characters (PRD §4.2). */
export const VIBE_LABELS: Record<VibeId, string> = {
  feel_good: 'Feel-good',
  mind_bending: 'Mind-bending',
  edge_of_seat: 'Edge-of-your-seat',
  slow_burn: 'Slow burn',
  tearjerker: 'Tearjerker',
  cosy: 'Cosy',
  dark: 'Dark',
  funny: 'Funny',
  epic: 'Epic',
  true_story: 'True story',
  family_friendly: 'Family-friendly',
  bingeable: 'Bingeable',
  romantic: 'Romantic',
  thought_provoking: 'Thought-provoking',
  action_packed: 'Action-packed',
  spooky: 'Spooky',
  stylish: 'Stylish',
  quirky: 'Quirky',
};

const ORDER = Object.keys(VIBE_LABELS) as VibeId[];

type Weights = readonly (readonly [VibeId, number])[];

/** TMDB genre id → weights (movie and TV ids share one table; they do not collide). */
export const GENRE_VIBES: Record<number, Weights> = {
  28: [['action_packed', 2]], // Action
  12: [
    ['epic', 1],
    ['action_packed', 1],
  ], // Adventure
  35: [['funny', 2]], // Comedy
  80: [
    ['dark', 1],
    ['edge_of_seat', 1],
  ], // Crime
  99: [
    ['true_story', 2],
    ['thought_provoking', 1],
  ], // Documentary
  18: [['thought_provoking', 1]], // Drama
  10751: [['family_friendly', 2]], // Family
  14: [['epic', 1]], // Fantasy
  36: [
    ['thought_provoking', 1],
    ['epic', 1],
  ], // History
  27: [
    ['spooky', 2],
    ['dark', 1],
  ], // Horror
  10402: [['feel_good', 1]], // Music
  9648: [
    ['mind_bending', 1],
    ['edge_of_seat', 1],
  ], // Mystery
  10749: [['romantic', 2]], // Romance
  878: [
    ['mind_bending', 1],
    ['epic', 1],
  ], // Science Fiction
  53: [['edge_of_seat', 2]], // Thriller
  10752: [
    ['dark', 1],
    ['epic', 1],
  ], // War
  37: [['epic', 1]], // Western
  10759: [['action_packed', 2]], // TV: Action & Adventure
  10762: [['family_friendly', 2]], // TV: Kids
  10765: [
    ['mind_bending', 1],
    ['epic', 1],
  ], // TV: Sci-Fi & Fantasy
  10768: [
    ['thought_provoking', 1],
    ['dark', 1],
  ], // TV: War & Politics
};

/** ALLOWLIST: TMDB keyword name (lowercase) → weights. Premise-level words only; nothing that spoils. */
export const KEYWORD_VIBES: Record<string, Weights> = {
  'based on true story': [['true_story', 3]],
  'based on real events': [['true_story', 3]],
  biography: [['true_story', 3]],
  'historical figure': [['true_story', 2]],
  'feel-good': [['feel_good', 3]],
  heartwarming: [['feel_good', 3]],
  underdog: [['feel_good', 2]],
  hope: [['feel_good', 2]],
  'found family': [
    ['cosy', 2],
    ['feel_good', 1],
  ],
  'coming of age': [
    ['feel_good', 1],
    ['tearjerker', 1],
  ],
  'time travel': [['mind_bending', 3]],
  'parallel universe': [['mind_bending', 3]],
  multiverse: [['mind_bending', 3]],
  'alternate reality': [['mind_bending', 3]],
  'nonlinear timeline': [['mind_bending', 3]],
  dream: [['mind_bending', 2]],
  surreal: [
    ['mind_bending', 2],
    ['quirky', 1],
  ],
  'first contact': [
    ['thought_provoking', 2],
    ['mind_bending', 1],
  ],
  'artificial intelligence': [
    ['mind_bending', 2],
    ['thought_provoking', 2],
  ],
  'slow burn': [['slow_burn', 3]],
  'character study': [
    ['slow_burn', 2],
    ['thought_provoking', 1],
  ],
  meditative: [['slow_burn', 3]],
  suspense: [['edge_of_seat', 2]],
  heist: [['edge_of_seat', 2]],
  survival: [['edge_of_seat', 2]],
  conspiracy: [['edge_of_seat', 2]],
  obsession: [
    ['edge_of_seat', 2],
    ['dark', 1],
  ],
  anxiety: [['edge_of_seat', 2]],
  detective: [
    ['mind_bending', 1],
    ['edge_of_seat', 1],
  ],
  'psychological thriller': [
    ['edge_of_seat', 2],
    ['mind_bending', 1],
  ],
  grief: [['tearjerker', 3]],
  melancholy: [['tearjerker', 2]],
  'father daughter relationship': [['tearjerker', 1]],
  'mother daughter relationship': [['tearjerker', 1]],
  'small town': [['cosy', 1]],
  cooking: [['cosy', 2]],
  restaurant: [['cosy', 1]],
  'slice of life': [['cosy', 3]],
  sitcom: [
    ['cosy', 2],
    ['funny', 2],
    ['bingeable', 1],
  ],
  'workplace comedy': [
    ['cosy', 2],
    ['funny', 1],
  ],
  'dark comedy': [
    ['dark', 2],
    ['funny', 2],
  ],
  dystopia: [
    ['dark', 2],
    ['thought_provoking', 1],
  ],
  'post-apocalyptic future': [
    ['dark', 2],
    ['epic', 1],
  ],
  'drug trade': [['dark', 2]],
  mafia: [['dark', 2]],
  'organized crime': [['dark', 2]],
  revenge: [
    ['dark', 1],
    ['edge_of_seat', 1],
  ],
  'serial killer': [['dark', 3]],
  satire: [
    ['funny', 2],
    ['thought_provoking', 1],
  ],
  mockumentary: [['funny', 3]],
  parody: [['funny', 3]],
  epic: [['epic', 3]],
  'space opera': [['epic', 3]],
  'space travel': [
    ['epic', 2],
    ['mind_bending', 1],
  ],
  'desert planet': [['epic', 1]],
  dragon: [['epic', 2]],
  samurai: [
    ['epic', 2],
    ['action_packed', 1],
  ],
  'feudal japan': [['epic', 2]],
  'family saga': [['epic', 2]],
  family: [['family_friendly', 1]],
  anthropomorphism: [['family_friendly', 1]],
  miniseries: [['bingeable', 3]],
  cliffhanger: [['bingeable', 2]],
  love: [['romantic', 2]],
  romance: [['romantic', 2]],
  'childhood sweetheart': [['romantic', 2]],
  musical: [
    ['feel_good', 2],
    ['stylish', 1],
  ],
  jazz: [['stylish', 2]],
  'social commentary': [['thought_provoking', 3]],
  'class differences': [['thought_provoking', 3]],
  philosophy: [['thought_provoking', 3]],
  existentialism: [['thought_provoking', 3]],
  'car chase': [['action_packed', 3]],
  'martial arts': [['action_packed', 3]],
  superhero: [
    ['action_packed', 2],
    ['epic', 1],
  ],
  'fighter pilot': [['action_packed', 2]],
  supernatural: [['spooky', 2]],
  vampire: [['spooky', 2]],
  monster: [['spooky', 2]],
  'body horror': [
    ['spooky', 3],
    ['dark', 2],
  ],
  'neo-noir': [
    ['stylish', 3],
    ['dark', 1],
  ],
  cyberpunk: [
    ['stylish', 2],
    ['mind_bending', 1],
  ],
  fashion: [['stylish', 2]],
  quirky: [['quirky', 3]],
  eccentric: [['quirky', 2]],
  absurdism: [
    ['quirky', 3],
    ['funny', 1],
  ],
};

/**
 * Keywords matching any of these must never be allowlisted (they tend to reveal plot). Used by tests,
 * and applied defensively at runtime so a bad table edit still cannot surface a spoiler.
 */
export const SPOILER_PATTERNS: readonly RegExp[] = [
  /twist/,
  /death|dies|dying|dead\b|killed|murder of|suicide/,
  /ending|finale|reveal|revealed|unmask/,
  /betray/,
  /secret identity|true identity|imposter|impostor/,
  /surprise|shock/,
  /flash ?forward/,
  /(is|was) (a |the )?(ghost|killer|villain|dream)/,
];

export function isSpoilerKeyword(k: string): boolean {
  return SPOILER_PATTERNS.some((re) => re.test(k));
}

export const MIN_VIBE_SCORE = 2;
export const MAX_VIBES = 3;

export function normalizeKeyword(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Up to 3 vibes, strongest first (ties broken by VIBE_LABELS order). A vibe needs a score >= 2, so one
 * weak genre signal alone never produces a tag.
 */
export function vibesFor(input: {
  mediaType: MediaType;
  genreIds: number[];
  keywords: string[];
  /** TV total minutes (episodes × runtime), if known. Short shows get "Bingeable". */
  totalMinutes?: number | null;
}): Vibe[] {
  const score = new Map<VibeId, number>();
  const add = (w: Weights | undefined) => {
    for (const [id, n] of w ?? []) score.set(id, (score.get(id) ?? 0) + n);
  };
  for (const g of new Set(input.genreIds)) add(GENRE_VIBES[g]);
  for (const raw of new Set(input.keywords.map(normalizeKeyword))) {
    if (isSpoilerKeyword(raw)) continue;
    add(KEYWORD_VIBES[raw]);
  }
  if (
    input.mediaType === 'tv' &&
    input.totalMinutes != null &&
    input.totalMinutes > 0 &&
    input.totalMinutes <= 600
  ) {
    add([['bingeable', 2]]);
  }
  return [...score.entries()]
    .filter(([, n]) => n >= MIN_VIBE_SCORE)
    .sort((a, b) => b[1] - a[1] || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .slice(0, MAX_VIBES)
    .map(([id]) => ({ id, label: VIBE_LABELS[id] }));
}
