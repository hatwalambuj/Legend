/**
 * Demo users, stubs, reviews and watchlist (ADR-006). `npm run fixtures:build` → src/fixtures/seed.json.
 * All demo accounts use the password in DEMO_PASSWORD (src/server/env.ts): "stubbed-demo".
 * Dates are fixed and assume DEMO_TODAY=2026-09-26 for deterministic demos and E2E.
 *
 * QA hooks (PRD §12 / SYSTEM_DESIGN §15.3):
 * - dev has 4 stubs on The Office (tv:2316) and 3 on Interstellar → rewatch counts.
 * - dev has a stub on Twilight (movie:8966, rated 6.4, unlisted) → hysteresis "BELOW 6.5 NOW".
 * - priya's Succession review is a spoiler; priya's Parasite review is marked "Posted on IMDb".
 * - maya's Dune: Part Two review is linked to her stub #2.
 * - Dune: Part Two has 5 user ratings → the Stubbed community average unlocks.
 * - leo has no stubs/reviews → empty wallet state.
 */

export interface SourceUser {
  id: string;
  handle: string;
  email: string;
  displayName: string;
  bio: string;
  createdAt: string;
}

export interface SourceStub {
  id: string;
  user: string; // handle
  title: string; // TitleKey
  watchedOn: string;
  watchedWhere: 'cinema' | 'streaming' | 'tv' | 'other' | null;
  note?: string;
}

export interface SourceReview {
  id: string;
  user: string;
  title: string;
  rating10: number;
  body: string;
  isSpoiler?: boolean;
  stubId?: string;
  imdbSharedAt?: string;
  createdAt: string;
  editedAt?: string;
}

export const USERS: SourceUser[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    handle: 'maya',
    email: 'maya@demo.stubbed.app',
    displayName: 'Maya',
    bio: 'Film student. Will cry at anything by Celine Song.',
    createdAt: '2022-04-11T10:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    handle: 'dev',
    email: 'dev@demo.stubbed.app',
    displayName: 'Dev',
    bio: 'Professional rewatcher. The Office is a lifestyle.',
    createdAt: '2023-01-02T10:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    handle: 'priya',
    email: 'priya@demo.stubbed.app',
    displayName: 'Priya',
    bio: 'I write long reviews so you don’t have to.',
    createdAt: '2022-09-20T10:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    handle: 'sam',
    email: 'sam@demo.stubbed.app',
    displayName: 'Sam',
    bio: 'Sci-fi or bust.',
    createdAt: '2024-02-01T10:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    handle: 'jun',
    email: 'jun@demo.stubbed.app',
    displayName: 'Jun',
    bio: 'Anime, K-drama, and anything with a good score.',
    createdAt: '2024-06-15T10:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    handle: 'leo',
    email: 'leo@demo.stubbed.app',
    displayName: 'Leo',
    bio: '',
    createdAt: '2026-09-20T10:00:00Z',
  },
];

let n = 0;
const sid = () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export const STUBS: SourceStub[] = [
  // maya
  {
    id: sid(),
    user: 'maya',
    title: 'movie:693134',
    watchedOn: '2026-03-02',
    watchedWhere: 'cinema',
    note: 'IMAX. Front row was a mistake.',
  },
  {
    id: sid(),
    user: 'maya',
    title: 'movie:693134',
    watchedOn: '2026-09-12',
    watchedWhere: 'streaming',
    note: 'Better the second time.',
  },
  {
    id: sid(),
    user: 'maya',
    title: 'movie:666277',
    watchedOn: '2026-08-30',
    watchedWhere: 'streaming',
  },
  {
    id: sid(),
    user: 'maya',
    title: 'movie:965150',
    watchedOn: '2026-08-14',
    watchedWhere: 'streaming',
    note: 'Under Pressure. Gone.',
  },
  {
    id: sid(),
    user: 'maya',
    title: 'tv:95396',
    watchedOn: '2026-09-20',
    watchedWhere: 'streaming',
  },
  {
    id: sid(),
    user: 'maya',
    title: 'tv:136315',
    watchedOn: '2026-07-05',
    watchedWhere: 'streaming',
  },
  {
    id: sid(),
    user: 'maya',
    title: 'movie:346698',
    watchedOn: '2026-06-21',
    watchedWhere: 'cinema',
  },
  { id: sid(), user: 'maya', title: 'movie:545611', watchedOn: '2026-05-09', watchedWhere: 'tv' },
  {
    id: sid(),
    user: 'maya',
    title: 'movie:129',
    watchedOn: '2026-04-18',
    watchedWhere: 'streaming',
  },
  {
    id: sid(),
    user: 'maya',
    title: 'movie:531428',
    watchedOn: '2026-02-14',
    watchedWhere: 'streaming',
    note: 'Valentine’s Day, alone, on purpose.',
  },
  // dev (the rewatcher)
  { id: sid(), user: 'dev', title: 'tv:2316', watchedOn: '2024-01-15', watchedWhere: 'streaming' },
  { id: sid(), user: 'dev', title: 'tv:2316', watchedOn: '2025-01-20', watchedWhere: 'streaming' },
  {
    id: sid(),
    user: 'dev',
    title: 'tv:2316',
    watchedOn: '2026-01-11',
    watchedWhere: 'streaming',
    note: 'Annual tradition.',
  },
  {
    id: sid(),
    user: 'dev',
    title: 'tv:2316',
    watchedOn: '2026-09-25',
    watchedWhere: 'tv',
    note: 'Dinner Party episode on loop.',
  },
  {
    id: sid(),
    user: 'dev',
    title: 'movie:157336',
    watchedOn: '2014-11-08',
    watchedWhere: 'cinema',
  },
  { id: sid(), user: 'dev', title: 'movie:157336', watchedOn: '2020-06-01', watchedWhere: 'tv' },
  {
    id: sid(),
    user: 'dev',
    title: 'movie:157336',
    watchedOn: '2026-07-19',
    watchedWhere: 'cinema',
    note: '70mm re-release!',
  },
  { id: sid(), user: 'dev', title: 'tv:1668', watchedOn: '2025-05-03', watchedWhere: 'streaming' },
  { id: sid(), user: 'dev', title: 'tv:1668', watchedOn: '2026-08-02', watchedWhere: 'streaming' },
  {
    id: sid(),
    user: 'dev',
    title: 'movie:8966',
    watchedOn: '2026-03-20',
    watchedWhere: 'streaming',
    note: 'Ironically. Mostly.',
  },
  { id: sid(), user: 'dev', title: 'tv:1396', watchedOn: '2025-11-30', watchedWhere: 'streaming' },
  { id: sid(), user: 'dev', title: 'tv:94605', watchedOn: '2026-09-01', watchedWhere: 'streaming' },
  // priya
  {
    id: sid(),
    user: 'priya',
    title: 'movie:496243',
    watchedOn: '2026-01-25',
    watchedWhere: 'streaming',
  },
  {
    id: sid(),
    user: 'priya',
    title: 'movie:872585',
    watchedOn: '2023-07-22',
    watchedWhere: 'cinema',
  },
  {
    id: sid(),
    user: 'priya',
    title: 'tv:87108',
    watchedOn: '2025-10-12',
    watchedWhere: 'streaming',
  },
  {
    id: sid(),
    user: 'priya',
    title: 'tv:76331',
    watchedOn: '2026-05-30',
    watchedWhere: 'streaming',
  },
  {
    id: sid(),
    user: 'priya',
    title: 'tv:126308',
    watchedOn: '2026-04-22',
    watchedWhere: 'streaming',
  },
  { id: sid(), user: 'priya', title: 'movie:244786', watchedOn: '2026-02-03', watchedWhere: 'tv' },
  { id: sid(), user: 'priya', title: 'movie:238', watchedOn: '2025-12-24', watchedWhere: 'tv' },
  {
    id: sid(),
    user: 'priya',
    title: 'movie:693134',
    watchedOn: '2026-03-09',
    watchedWhere: 'cinema',
  },
  // sam, jun
  {
    id: sid(),
    user: 'sam',
    title: 'movie:693134',
    watchedOn: '2026-03-01',
    watchedWhere: 'cinema',
  },
  {
    id: sid(),
    user: 'sam',
    title: 'movie:335984',
    watchedOn: '2026-06-06',
    watchedWhere: 'streaming',
  },
  {
    id: sid(),
    user: 'jun',
    title: 'movie:693134',
    watchedOn: '2026-03-15',
    watchedWhere: 'cinema',
  },
  { id: sid(), user: 'jun', title: 'tv:1429', watchedOn: '2026-01-08', watchedWhere: 'streaming' },
  {
    id: sid(),
    user: 'jun',
    title: 'movie:372058',
    watchedOn: '2026-02-21',
    watchedWhere: 'streaming',
  },
];

let r = 0;
const rid = () => `20000000-0000-4000-8000-${String(++r).padStart(12, '0')}`;
const stubOf = (user: string, title: string, nth = 1) =>
  STUBS.filter((s) => s.user === user && s.title === title)[nth - 1]?.id;

export const REVIEWS: SourceReview[] = [
  {
    id: rid(),
    user: 'maya',
    title: 'movie:693134',
    rating10: 9,
    body: 'The second watch is where it clicked for me: this is a tragedy wearing a blockbuster’s clothes. Zendaya carries the ending.',
    stubId: stubOf('maya', 'movie:693134', 2),
    createdAt: '2026-09-12T22:10:00Z',
    editedAt: '2026-09-13T08:00:00Z',
  },
  {
    id: rid(),
    user: 'maya',
    title: 'movie:666277',
    rating10: 10,
    body: 'In-yun. That’s it, that’s the review.',
    createdAt: '2026-08-30T23:00:00Z',
  },
  {
    id: rid(),
    user: 'maya',
    title: 'movie:965150',
    rating10: 9,
    body: '',
    createdAt: '2026-08-14T23:30:00Z',
  },
  {
    id: rid(),
    user: 'dev',
    title: 'tv:2316',
    rating10: 10,
    body: 'Fourth full rewatch. Still finding jokes in the background of the conference room.',
    stubId: stubOf('dev', 'tv:2316', 4),
    createdAt: '2026-09-25T21:00:00Z',
  },
  {
    id: rid(),
    user: 'dev',
    title: 'movie:157336',
    rating10: 10,
    body: 'Saw it in 70mm this summer. The organ still rattles your ribs.',
    createdAt: '2026-07-19T23:40:00Z',
  },
  {
    id: rid(),
    user: 'priya',
    title: 'movie:496243',
    rating10: 10,
    body: 'Bong Joon-ho builds the house before he floods it. Every staircase in this film is an argument about class, and the peach scene is the most tense thing I have seen about fruit.',
    imdbSharedAt: '2026-01-26T09:15:00Z',
    createdAt: '2026-01-25T22:00:00Z',
  },
  {
    id: rid(),
    user: 'priya',
    title: 'tv:76331',
    rating10: 9,
    body: 'The finale lands exactly where it should: Kendall on the waterfront, having lost the only thing he ever wanted, and Tom walking away with it. Shiv’s hand on the car is the whole show.',
    isSpoiler: true,
    createdAt: '2026-05-30T23:10:00Z',
  },
  {
    id: rid(),
    user: 'priya',
    title: 'tv:87108',
    rating10: 10,
    body: 'The best TV about institutional failure ever made. Episode one is a horror film.',
    createdAt: '2025-10-13T20:00:00Z',
  },
  {
    id: rid(),
    user: 'priya',
    title: 'tv:126308',
    rating10: 9,
    body: 'Patient, gorgeous, and ruthless. Anna Sawai deserves every award.',
    createdAt: '2026-04-23T19:00:00Z',
  },
  {
    id: rid(),
    user: 'priya',
    title: 'movie:244786',
    rating10: 8,
    body: 'A thriller about a drum solo. The final ten minutes are an action sequence.',
    createdAt: '2026-02-03T22:00:00Z',
  },
  {
    id: rid(),
    user: 'priya',
    title: 'movie:238',
    rating10: 10,
    body: 'Christmas Eve tradition. Nothing has ever been lit like the opening wedding.',
    createdAt: '2025-12-24T23:00:00Z',
  },
  {
    id: rid(),
    user: 'priya',
    title: 'movie:872585',
    rating10: 8,
    body: 'Three hours that feel like two. The Trinity sequence is silence used as a weapon.',
    createdAt: '2023-07-23T10:00:00Z',
  },
  {
    id: rid(),
    user: 'priya',
    title: 'movie:693134',
    rating10: 8,
    body: 'Villeneuve directs sand better than anyone alive.',
    createdAt: '2026-03-09T23:00:00Z',
  },
  {
    id: rid(),
    user: 'sam',
    title: 'movie:693134',
    rating10: 10,
    body: 'Harkonnen arena in black-and-white sunlight. I gasped.',
    createdAt: '2026-03-01T23:00:00Z',
  },
  {
    id: rid(),
    user: 'dev',
    title: 'movie:693134',
    rating10: 8,
    body: 'Haven’t stubbed it yet (watched at a friend’s), but the worm ride alone is an 8.',
    createdAt: '2026-04-02T21:00:00Z',
  },
  {
    id: rid(),
    user: 'jun',
    title: 'movie:693134',
    rating10: 7,
    body: 'Great spectacle, but I missed the weirdness of the book.',
    createdAt: '2026-03-15T23:00:00Z',
  },
  {
    id: rid(),
    user: 'jun',
    title: 'tv:1429',
    rating10: 9,
    body: 'The season 3 part 2 turn changes the whole show. Stick with it.',
    createdAt: '2026-01-09T12:00:00Z',
  },
];

export const WATCHLIST: { user: string; title: string; addedAt: string }[] = [
  { user: 'maya', title: 'movie:792307', addedAt: '2026-09-10T12:00:00Z' },
  { user: 'maya', title: 'tv:100088', addedAt: '2026-09-15T12:00:00Z' },
  { user: 'maya', title: 'movie:1064213', addedAt: '2026-09-18T12:00:00Z' },
  { user: 'dev', title: 'tv:1438', addedAt: '2026-08-01T12:00:00Z' },
];
