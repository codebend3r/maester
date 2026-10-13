# raven smart scan, step 3: matching by library type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A library's type steers matching. Anime libraries prefer Japanese animation, then any animation; Family libraries prefer family films and animation; Documentaries prefer documentaries. Changing between two such types matches the files again, and Fix match lists the results the library prefers first.

**Architecture:**
- `@raven/core` gains the tiers: `CandidateTier`, the named `TIER_SETS`, and `fitsTier`, which says whether a TMDB result fits a tier. `KIND_RULES` names each type's tier set.
- The server's search results keep TMDB's `genre_ids` and `original_language`. `pickByTiers` runs `pickMatch` over each tier's results in turn. A `MatchPass` is built with its library's tiers, so every search, alias lookup and adult retry in it goes through them.
- The libraries controller rematches when the tier set changes as well as the match type. `GET /api/match/search` takes an optional `libraryId` and sorts the results that fit that library's first tier ahead of the rest.

**Tech Stack:** NestJS 12, vitest and better-sqlite3 (server); `@raven/core` and bun test (core); React 19, TanStack Query and bun test with happy-dom (web).

**Spec:** `docs/superpowers/specs/2026-10-12-raven-smart-scan-design.md`, section 2 ("Matching by library type"), the S2 outcomes, and "Order of work" step 3.

## Global Constraints

- Every rule in the root `CLAUDE.md` holds:
  - no `any`, no casts, and no non-null assertions outside tests;
  - `type`, never `interface`, and no enums;
  - named exports only;
  - no `for`, `for...of` or `for...in` loops;
  - one object parameter wherever there are two or more;
  - `@/` imports with no extension;
  - `??` over `||`;
  - no em or en dashes anywhere, comments and UI copy included.
- `libs/raven/core` stays free of DOM and Node APIs.
- TMDB uses the same genre ids for movies and TV here: Animation 16, Family 10751, Documentary 99.
- The tiers, in order:

  | Kinds | Tiers, in order |
  | --- | --- |
  | `animeShows`, `animeMovies` | Animation from Japan (`ja` or `JP`), then any animation, then anything |
  | `familyShows`, `familyMovies` | Family or Animation, then anything |
  | `documentaries` | Documentary, then anything |
  | `movies`, `shows` | anything (today's behaviour) |

- A result fits a tier when it has one of the tier's genres, if any are listed, and its original language or one of its origin countries is in the tier's lists, if any are listed.
- The lone-result rule applies only on the unfiltered tier, so a filter never turns "one result left" into a guess.
- No retry without the year: a show whose year-filtered search picks nothing stays unmatched (the AI lookup in step 4 handles those).
- Server constructors inject with explicit `@Inject(Token)`.
- Run tasks through Nx from the repo root:
  - `bunx nx run @raven/core:test`, `bunx nx run @raven/server:test` and `bunx nx run @raven/web:test`;
  - one file at a time with `-- <path>`, as in `bunx nx run @raven/server:test -- src/metadata/matcher.test.ts`;
  - `bun run verify` before the PR.
- Commits follow the `commit-format` skill: a `MAE:` subject, a short bullet body, and no agent attribution.
- Branch `raven-smart-scan-types` from `raven-smart-scan-layout` (PR #135). The PR is stacked on #135.
- No migration in this step.

## Deviations from the spec, on purpose

- **`KindRules.prefer` names a tier set** (`'any' | 'anime' | 'family' | 'documentary'`, the keys of `TIER_SETS`) instead of holding the tier list. Two types then compare by name (`matchesAlike`), and the list stays written once.
- **The search cache key does not gain the tier set.** A `MatchPass` gets its library's tiers in its constructor and is made for one library's pass, or for one Fix match, so its cache never mixes two libraries' tiers.
- **`fitsTier` lives in core** (`candidateTiers.ts`), so the matcher and the Fix match ranking share it, and its table runs in core as the spec's Testing section asks.
- **Order inside a search:** the plain results go through every tier first, then the alias lookup goes through every tier, then the adult retry does. A plain pick in a later tier beats an alias pick in an earlier one. Alias lookups cost up to five calls, so they stay for the searches no tier can answer, as in the spike.
- **`fixShowMatch` leaves a library that is no longer a show library alone.** It needs the library's type for the pass's tiers, and a type change already queued unlinks those files anyway.

## Review Focus

1. **A Movies or TV library matches exactly as it does today:** the same picks, and no extra TMDB calls. Its tier set is one unfiltered tier. Pinned in Task 2 (`pickByTiers` with `TIER_SETS.any` agrees with `pickMatch`, lone result included) and by every existing `movies.test.ts` and `shows.test.ts` case passing unchanged except the two type-change cases rewritten in Task 4.
2. **A filtered tier never takes a lone result of another title.** In an Anime library, a search whose only Japanese anime result has a different title must not pick it. Pinned in Task 2.
3. **A Fix match survives a type change that now rematches** (Movies to Anime movies keeps "Unknown Thing" on its manual match). Pinned in Task 4 (`movies.test.ts`).
4. **A movie search result carries no countries**, so a Japanese anime film has to fit the Japan tier by its language alone. Pinned in Task 1 (`fitsTier` with `countries: []`).
5. **Switching between two types that are never matched** (Sporting events, YouTube videos, Other) still touches nothing. Pinned in Task 1 (`matchesAlike` table) and Task 4 (the controller reads `matchesAlike`).

---

## Files

| File | Change |
| --- | --- |
| `libs/raven/core/src/candidateTiers.ts` (new) | `TMDB_GENRES`, `CandidateTier`, `TierFacts`, `TIER_SETS`, `TierSet`, `isUnfiltered`, `fitsTier` |
| `libs/raven/core/src/candidateTiers.test.ts` (new) | the fit table |
| `libs/raven/core/src/libraryKinds.ts` | `KindRules.prefer`; `tiersFor`, `firstTierFor`, `matchesAlike` |
| `libs/raven/core/src/libraryKinds.test.ts` | the rules test reads `prefer`; `tiersFor`, `matchesAlike` |
| `libs/raven/core/src/index.ts` | export `@/candidateTiers` |
| `libs/raven/core/src/apiClient.ts`, `apiClient.test.ts` | `searchMatches` takes `libraryId` |
| `apps/raven/server/src/metadata/tmdbClient.ts`, `tmdbClient.test.ts` | `SearchResult.genreIds`, `originalLanguage` |
| `apps/raven/server/src/test/fakeTmdb.ts` | search results carry `genre_ids` and `original_language` |
| `apps/raven/server/src/metadata/matcher.ts`, `matcher.test.ts` | `pickByTiers` |
| `apps/raven/server/src/metadata/matchPass.ts`, `matchPass.test.ts` | `MatchPassDeps.prefer`; searches pick by tiers |
| `apps/raven/server/src/metadata/matchers.test.ts` | its pass gets `prefer` |
| `apps/raven/server/src/metadata/metadataService.ts` | passes are built with the library's tiers |
| `apps/raven/server/src/libraries/librariesController.ts` | rematch when `matchesAlike` is false |
| `apps/raven/server/src/metadata/movies.test.ts`, `shows.test.ts` | the type-change cases now rematch |
| `apps/raven/server/src/metadata/libraryTypes.test.ts` (new) | end to end: Cowboy Bebop in TV and in Anime shows; Fix match order |
| `apps/raven/server/src/items/matchController.ts` | `libraryId` sorts the library's first tier first |
| `apps/raven/web/src/lib/queryClient.ts`, `queries.ts` | `libraryId` in the search's key and call |
| `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.tsx`, `.test.tsx` | `libraryId` prop |
| `apps/raven/web/src/components/MediaMenu/MediaMenu.tsx`, `UnmatchedShows/UnmatchedShows.tsx` | pass the file's library |
| `apps/raven/README.md` | what a type change rematches; how types steer matching and Fix match |

---

### Task 1: The tiers in core

**Files:**
- Create: `libs/raven/core/src/candidateTiers.ts`
- Create: `libs/raven/core/src/candidateTiers.test.ts`
- Modify: `libs/raven/core/src/libraryKinds.ts`
- Modify: `libs/raven/core/src/libraryKinds.test.ts`
- Modify: `libs/raven/core/src/index.ts`

**Interfaces:**
- Consumes: `KIND_RULES`, `matchTypeFor`, `LibraryKind` (existing).
- Produces:
  - `TMDB_GENRES: { animation: 16; family: 10751; documentary: 99 }`
  - `type CandidateTier = { genres?: readonly number[]; languages?: readonly string[]; countries?: readonly string[] }`
  - `type TierFacts = { genreIds: readonly number[]; originalLanguage: string | null; countries: readonly string[] }`
  - `TIER_SETS` (`as const`, keys `any`, `anime`, `family`, `documentary`), `type TierSet = keyof typeof TIER_SETS`
  - `isUnfiltered(tier: CandidateTier): boolean`
  - `fitsTier({ tier, result }: { tier: CandidateTier; result: TierFacts }): boolean`
  - `KindRules.prefer: TierSet`
  - `tiersFor(kind: LibraryKind): readonly CandidateTier[]`
  - `firstTierFor(kind: LibraryKind): CandidateTier`
  - `matchesAlike({ before, after }: { before: LibraryKind; after: LibraryKind }): boolean`

- [ ] **Step 1: Write the failing tier tests**

Create `libs/raven/core/src/candidateTiers.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import {
  type CandidateTier,
  type TierFacts,
  TIER_SETS,
  TMDB_GENRES,
  fitsTier,
  isUnfiltered,
} from '@/candidateTiers'

const facts = (overrides: Partial<TierFacts>): TierFacts => ({
  genreIds: [],
  originalLanguage: null,
  countries: [],
  ...overrides,
})

const [japanese, animated, anything] = TIER_SETS.anime

/** Which of a set's tiers a result fits, by index. */
const fits = ({ set, result }: { set: readonly CandidateTier[]; result: TierFacts }): number[] =>
  set.flatMap((tier, index) => (fitsTier({ tier, result }) ? [index] : []))

describe('fitsTier', () => {
  it('fits a Japanese anime series to every anime tier', () => {
    const bebop = facts({ genreIds: [16, 10759], originalLanguage: 'ja', countries: ['JP'] })
    expect(fits({ set: TIER_SETS.anime, result: bebop })).toEqual([0, 1, 2])
  })

  it('fits an anime film by its language alone, as a movie search gives no countries', () => {
    const paprika = facts({ genreIds: [16, 878], originalLanguage: 'ja' })
    expect(fitsTier({ tier: japanese, result: paprika })).toBe(true)
  })

  it('fits a show made in Japan in English by its country', () => {
    const show = facts({ genreIds: [16], originalLanguage: 'en', countries: ['JP'] })
    expect(fitsTier({ tier: japanese, result: show })).toBe(true)
  })

  it('fits animation from elsewhere to the animation tier, not the Japanese one', () => {
    const donghua = facts({ genreIds: [16], originalLanguage: 'zh', countries: ['CN'] })
    const castlevania = facts({ genreIds: [16, 10759], originalLanguage: 'en', countries: ['US'] })
    expect(fits({ set: TIER_SETS.anime, result: donghua })).toEqual([1, 2])
    expect(fits({ set: TIER_SETS.anime, result: castlevania })).toEqual([1, 2])
  })

  it('fits Japanese live action only to the last anime tier', () => {
    const drama = facts({ genreIds: [18], originalLanguage: 'ja', countries: ['JP'] })
    expect(fits({ set: TIER_SETS.anime, result: drama })).toEqual([2])
  })

  it('fits a result TMDB lists no genres for only where nothing is filtered', () => {
    expect(fitsTier({ tier: animated, result: facts({ originalLanguage: 'ja' }) })).toBe(false)
    expect(fitsTier({ tier: anything, result: facts({}) })).toBe(true)
  })

  it('fits family films and animation first in a family library', () => {
    expect(fits({ set: TIER_SETS.family, result: facts({ genreIds: [10751, 35] }) })).toEqual([
      0, 1,
    ])
    expect(fits({ set: TIER_SETS.family, result: facts({ genreIds: [16] }) })).toEqual([0, 1])
    expect(fits({ set: TIER_SETS.family, result: facts({ genreIds: [27] }) })).toEqual([1])
  })

  it('fits documentaries first in a documentaries library', () => {
    const doc = facts({ genreIds: [TMDB_GENRES.documentary] })
    expect(fits({ set: TIER_SETS.documentary, result: doc })).toEqual([0, 1])
    expect(fits({ set: TIER_SETS.documentary, result: facts({ genreIds: [18] }) })).toEqual([1])
  })
})

describe('the tier sets', () => {
  it('end every set with a tier that is every result, so no type matches less than Movies', () => {
    expect(Object.values(TIER_SETS).map((set) => isUnfiltered(set.at(-1)!))).toEqual([
      true,
      true,
      true,
      true,
    ])
  })

  it('filter every tier but the last', () => {
    expect(
      Object.values(TIER_SETS).flatMap((set) => set.slice(0, -1).filter(isUnfiltered)),
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx nx run @raven/core:test -- src/candidateTiers.test.ts`
Expected: FAIL, `Cannot find module '@/candidateTiers'`.

- [ ] **Step 3: Write `candidateTiers.ts`**

Create `libs/raven/core/src/candidateTiers.ts`:

```ts
/** The genre ids of TMDB's the tiers read, the same for movies and shows. */
export const TMDB_GENRES = { animation: 16, family: 10751, documentary: 99 } as const

/**
 * A slice of TMDB's search results a type of library prefers. A result fits
 * when it has one of `genres`, if any are listed, and its original language
 * is one of `languages` or one of its countries is one of `countries`, if
 * either is listed. A tier that lists nothing is every result.
 */
export type CandidateTier = {
  genres?: readonly number[]
  /** ISO 639-1, as TMDB's `original_language` gives it: `ja`. */
  languages?: readonly string[]
  /** ISO 3166-1, as TMDB's `origin_country` gives it: `JP`. */
  countries?: readonly string[]
}

/** What a tier reads of a search result. */
export type TierFacts = {
  genreIds: readonly number[]
  originalLanguage: string | null
  /** A show's countries of origin; a movie's search result has none. */
  countries: readonly string[]
}

const ANYTHING = {} as const satisfies CandidateTier

const { animation, family, documentary } = TMDB_GENRES

/**
 * The tiers each type of library searches, in order: the first that picks a
 * result wins. Every set ends with every result, so a type never matches
 * less than Movies or TV shows would. Anime falls back past Japan to any
 * animation, as Chinese donghua and Castlevania sit in Anime libraries too.
 */
export const TIER_SETS = {
  any: [ANYTHING],
  anime: [
    { genres: [animation], languages: ['ja'], countries: ['JP'] },
    { genres: [animation] },
    ANYTHING,
  ],
  family: [{ genres: [family, animation] }, ANYTHING],
  documentary: [{ genres: [documentary] }, ANYTHING],
} as const satisfies Record<string, readonly CandidateTier[]>

export type TierSet = keyof typeof TIER_SETS

/** Whether a tier is every result: the only tier a lone result in the name's year is taken from. */
export const isUnfiltered = (tier: CandidateTier): boolean =>
  tier.genres == null && tier.languages == null && tier.countries == null

export const fitsTier = ({ tier, result }: { tier: CandidateTier; result: TierFacts }): boolean => {
  const hasGenre = tier.genres?.some((genre) => result.genreIds.includes(genre)) ?? true
  if (tier.languages == null && tier.countries == null) return hasGenre
  const { originalLanguage } = result
  const isFromThere =
    (originalLanguage != null && (tier.languages?.includes(originalLanguage) ?? false)) ||
    result.countries.some((country) => tier.countries?.includes(country) ?? false)
  return hasGenre && isFromThere
}
```

Add `export * from '@/candidateTiers'` to `libs/raven/core/src/index.ts`, as its second line (after `@/apiClient`, keeping the list alphabetical).

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx nx run @raven/core:test -- src/candidateTiers.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `libraryKinds` tests**

In `libs/raven/core/src/libraryKinds.test.ts`, add `TIER_SETS` to the `@/candidateTiers` import (add the import line `import { TIER_SETS } from '@/candidateTiers'`), and add `firstTierFor`, `matchesAlike` and `tiersFor` to the `@/libraryKinds` import.

Replace the test `'reads anime like the movies or shows it is, and sporting events and YouTube videos like Other'` with:

```ts
  it('reads anime, family and documentaries like the movies or shows they are, preferring their own results', () => {
    expect({ ...KIND_RULES.animeMovies, prefer: 'any' }).toEqual(KIND_RULES.movies)
    expect({ ...KIND_RULES.animeShows, prefer: 'any' }).toEqual(KIND_RULES.shows)
    expect({ ...KIND_RULES.familyMovies, prefer: 'any' }).toEqual(KIND_RULES.movies)
    expect({ ...KIND_RULES.familyShows, prefer: 'any' }).toEqual(KIND_RULES.shows)
    expect({ ...KIND_RULES.documentaries, prefer: 'any' }).toEqual(KIND_RULES.movies)
    expect(KIND_RULES.sports).toEqual(KIND_RULES.other)
    expect(KIND_RULES.youtube).toEqual(KIND_RULES.other)
  })

  it('prefers Japanese animation in Anime libraries, family and animation in Family ones, and documentaries in Documentaries', () => {
    expect(LIBRARY_KINDS.map((kind) => [kind, KIND_RULES[kind].prefer])).toEqual([
      ['movies', 'any'],
      ['shows', 'any'],
      ['animeMovies', 'anime'],
      ['animeShows', 'anime'],
      ['familyMovies', 'family'],
      ['familyShows', 'family'],
      ['documentaries', 'documentary'],
      ['sports', 'any'],
      ['youtube', 'any'],
      ['other', 'any'],
    ])
    expect(tiersFor('animeShows')).toBe(TIER_SETS.anime)
    expect(tiersFor('movies')).toBe(TIER_SETS.any)
    expect(firstTierFor('animeMovies')).toEqual({
      genres: [16],
      languages: ['ja'],
      countries: ['JP'],
    })
    expect(firstTierFor('shows')).toEqual({})
  })
```

Add a new `describe` at the end of the file:

```ts
describe('matchesAlike', () => {
  it('says only types matched to the same thing, preferring the same results, match alike', () => {
    const alike = (before: LibraryKind, after: LibraryKind): boolean =>
      matchesAlike({ before, after })
    expect(alike('movies', 'movies')).toBe(true)
    expect(alike('movies', 'animeMovies')).toBe(false)
    expect(alike('movies', 'documentaries')).toBe(false)
    expect(alike('animeMovies', 'familyMovies')).toBe(false)
    expect(alike('animeMovies', 'animeShows')).toBe(false)
    expect(alike('shows', 'animeShows')).toBe(false)
    expect(alike('movies', 'other')).toBe(false)
    expect(alike('sports', 'other')).toBe(true)
    expect(alike('youtube', 'sports')).toBe(true)
  })
})
```

Add `type LibraryKind` to the file's `@/contract` import.

- [ ] **Step 6: Run them to verify they fail**

Run: `bunx nx run @raven/core:test -- src/libraryKinds.test.ts`
Expected: FAIL: `tiersFor`, `firstTierFor` and `matchesAlike` are not exported, and `prefer` is undefined.

- [ ] **Step 7: Give each type its tier set**

In `libs/raven/core/src/libraryKinds.ts`:

Add the import:

```ts
import { type CandidateTier, TIER_SETS, type TierSet } from '@/candidateTiers'
```

Add to `KindRules`, after `matches`:

```ts
  /** The search results it prefers, tier by tier: a key of `TIER_SETS`. */
  prefer: TierSet
```

Add `prefer: 'any',` after `matches` in `MOVIE_RULES`, `SHOW_RULES` and `UNMATCHED_RULES`.

Replace `KIND_RULES` and its comment with:

```ts
/**
 * Anime and family films and shows are matched on TMDB like any movie or
 * show, and documentaries as movies, as Radarr files them, each preferring
 * the results of its own kind. Sporting events and YouTube videos are not
 * there to match, so they are read like Other.
 */
export const KIND_RULES = {
  movies: MOVIE_RULES,
  shows: SHOW_RULES,
  animeMovies: { ...MOVIE_RULES, prefer: 'anime' },
  animeShows: { ...SHOW_RULES, prefer: 'anime' },
  familyMovies: { ...MOVIE_RULES, prefer: 'family' },
  familyShows: { ...SHOW_RULES, prefer: 'family' },
  documentaries: { ...MOVIE_RULES, prefer: 'documentary' },
  sports: UNMATCHED_RULES,
  youtube: UNMATCHED_RULES,
  other: UNMATCHED_RULES,
} as const satisfies Record<LibraryKind, KindRules>
```

After `matchTypeFor`, add:

```ts
/** The tiers a library of `kind` searches TMDB's results in, in order. */
export const tiersFor = (kind: LibraryKind): readonly CandidateTier[] =>
  TIER_SETS[KIND_RULES[kind].prefer]

/** The results a library of `kind` prefers most, which Fix match lists first. */
export const firstTierFor = (kind: LibraryKind): CandidateTier =>
  TIER_SETS[KIND_RULES[kind].prefer][0]

/**
 * Whether two types of library match their files alike: to the same type of
 * TMDB item, preferring the same results. A change between two that do not
 * matches every file again.
 */
export const matchesAlike = ({
  before,
  after,
}: {
  before: LibraryKind
  after: LibraryKind
}): boolean =>
  matchTypeFor(before) === matchTypeFor(after) &&
  KIND_RULES[before].prefer === KIND_RULES[after].prefer
```

- [ ] **Step 8: Run the core tests and typecheck**

Run: `bunx nx run @raven/core:test` and `bunx nx run @raven/core:typecheck`
Expected: PASS. (If the target is named differently, `bunx nx show project @raven/core` lists the targets.)

- [ ] **Step 9: Commit**

```bash
git add libs/raven/core/src/candidateTiers.ts libs/raven/core/src/candidateTiers.test.ts libs/raven/core/src/libraryKinds.ts libs/raven/core/src/libraryKinds.test.ts libs/raven/core/src/index.ts
git commit -m "MAE: raven core says which TMDB results each library type prefers" -m "- \`TIER_SETS\`: Japanese animation then any animation for anime, family and animation for family, documentaries for documentaries
- \`fitsTier\` reads a result's genres, language and countries
- \`KIND_RULES\` names each type's tiers; \`matchesAlike\` says when a type change rematches"
```

---

### Task 2: Search results keep genres and language, and `pickByTiers`

**Files:**
- Modify: `apps/raven/server/src/metadata/tmdbClient.ts` (`SearchResult` near line 154, `toSearchResult` near line 582)
- Modify: `apps/raven/server/src/metadata/tmdbClient.test.ts`
- Modify: `apps/raven/server/src/test/fakeTmdb.ts`
- Modify: `apps/raven/server/src/metadata/matcher.ts`
- Modify: `apps/raven/server/src/metadata/matcher.test.ts`

**Interfaces:**
- Consumes: `CandidateTier`, `TIER_SETS`, `fitsTier`, `isUnfiltered` from `@raven/core` (Task 1).
- Produces:
  - `SearchResult.genreIds: number[]`, `SearchResult.originalLanguage: string | null`
  - `FakeMovie.genreIds?: number[]`, `FakeMovie.language?: string`, `FakeShow.genreIds?: number[]`, `FakeShow.language?: string`
  - `pickByTiers(args: Parameters<typeof pickMatch>[0] & { prefer: readonly CandidateTier[] }): SearchResult | null`

- [ ] **Step 1: Write the failing search test**

In `apps/raven/server/src/metadata/tmdbClient.test.ts`, add to `describe('TmdbClient')` (the file already imports `fakeTmdb` and has the `config` helper):

```ts
  it('keeps the genres and language a search gives, which a library type prefers by', async () => {
    const tmdb = fakeTmdb({
      movies: [
        { id: 4977, title: 'Paprika', released: '2006-11-25', genreIds: [16, 878], language: 'ja' },
      ],
      shows: [
        {
          id: 30991,
          title: 'Cowboy Bebop',
          first: '1998-04-03',
          genreIds: [16, 10759],
          language: 'ja',
          countries: ['JP'],
          seasons: {},
        },
      ],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    const [paprika] = await client.searchMovies({ query: 'Paprika', year: 2006 })
    expect(paprika).toMatchObject({ genreIds: [16, 878], originalLanguage: 'ja', countries: [] })
    const [bebop] = await client.searchShows({ query: 'Cowboy Bebop', year: null })
    expect(bebop).toMatchObject({
      genreIds: [16, 10759],
      originalLanguage: 'ja',
      countries: ['JP'],
    })
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx nx run @raven/server:test -- src/metadata/tmdbClient.test.ts`
Expected: FAIL: the fake has no `genreIds` option (a type error is fine at this point), and `genreIds` is missing from the result.

- [ ] **Step 3: Keep the fields, and have the fake send them**

In `tmdbClient.ts`, add to `SearchResult` after `countries`:

```ts
  /** TMDB's genre ids, `[16, 10759]`, which a library's type prefers results by. */
  genreIds: number[]
  /** The language it was made in, as TMDB writes it: `ja`. */
  originalLanguage: string | null
```

In `toSearchResult`, after `countries`:

```ts
    genreIds: list(entry.genre_ids).filter(isNumber),
    originalLanguage: text(entry.original_language),
```

In `apps/raven/server/src/test/fakeTmdb.ts`, add to `FakeMovie`:

```ts
  /** TMDB's `genre_ids` in a search: Action and Science Fiction when not given. */
  genreIds?: number[]
  /** TMDB's `original_language`: `en` when not given. */
  language?: string
```

and to `FakeShow`:

```ts
  /** TMDB's `genre_ids` in a search: Drama when not given. */
  genreIds?: number[]
  /** TMDB's `original_language`: `en` when not given. */
  language?: string
```

In the `/search/movie` result map, add:

```ts
          genre_ids: movie.genreIds ?? [28, 878],
          original_language: movie.language ?? 'en',
```

In the `/search/tv` result map, add:

```ts
          genre_ids: show.genreIds ?? [18],
          original_language: show.language ?? 'en',
```

In `matcher.test.ts`, add `genreIds: [],` and `originalLanguage: null,` to the `result` helper's defaults, so it still builds a whole `SearchResult`.

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx nx run @raven/server:test -- src/metadata/tmdbClient.test.ts src/metadata/matcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `pickByTiers` tests**

Append to `apps/raven/server/src/metadata/matcher.test.ts` (and add `pickByTiers` to the `@/metadata/matcher` import, plus `import { TIER_SETS } from '@raven/core'`):

```ts
describe('pickByTiers', () => {
  /** The 2021 live-action series, listed first as the more popular. */
  const liveAction = result({
    tmdbId: '90660',
    title: 'Cowboy Bebop',
    year: 2021,
    popularity: 80,
    genreIds: [10759, 18],
    originalLanguage: 'en',
    countries: ['US'],
  })
  const anime = result({
    tmdbId: '30991',
    title: 'Cowboy Bebop',
    year: 1998,
    popularity: 60,
    genreIds: [16, 10759],
    originalLanguage: 'ja',
    countries: ['JP'],
  })

  it('takes the more popular series in a TV library, and the anime in an Anime one', () => {
    const asked = { type: 'show', title: 'Cowboy Bebop', year: null } as const
    const results = [liveAction, anime]
    expect(pickByTiers({ ...asked, results, prefer: TIER_SETS.any })).toBe(liveAction)
    expect(pickByTiers({ ...asked, results, prefer: TIER_SETS.anime })).toBe(anime)
  })

  it('takes Avatar: The Last Airbender as the cartoon in an Anime library, through the animation tier', () => {
    const asked = { type: 'show', title: 'Avatar The Last Airbender', year: null } as const
    const netflix = result({
      tmdbId: '82452',
      title: 'Avatar: The Last Airbender',
      year: 2024,
      popularity: 200,
      genreIds: [10759, 18],
      originalLanguage: 'en',
      countries: ['US'],
    })
    const cartoon = result({
      tmdbId: '246',
      title: 'Avatar: The Last Airbender',
      year: 2005,
      popularity: 100,
      genreIds: [16, 10759],
      originalLanguage: 'en',
      countries: ['US'],
    })
    const results = [netflix, cartoon]
    expect(pickByTiers({ ...asked, results, prefer: TIER_SETS.any })).toBe(netflix)
    expect(pickByTiers({ ...asked, results, prefer: TIER_SETS.anime })).toBe(cartoon)
  })

  it('matches a Chinese donghua in an Anime library through the animation tier', () => {
    const donghua = result({
      tmdbId: '259140',
      title: 'TO BE HERO X',
      year: 2025,
      genreIds: [16, 10759],
      originalLanguage: 'zh',
      countries: ['CN'],
    })
    expect(
      pickByTiers({
        type: 'show',
        title: 'To Be Hero X',
        year: 2025,
        results: [donghua],
        prefer: TIER_SETS.anime,
      }),
    ).toBe(donghua)
  })

  it('never takes the lone result a filter leaves when its title is another', () => {
    const other = result({
      tmdbId: '1',
      title: 'Ninja Scroll: The Series',
      year: 2003,
      genreIds: [16],
      originalLanguage: 'ja',
      countries: ['JP'],
    })
    const liveDrama = result({ tmdbId: '2', title: 'Ninja Detective', year: 2003, genreIds: [18] })
    expect(
      pickByTiers({
        type: 'show',
        title: 'Ninja Scroll',
        year: 2003,
        results: [other, liveDrama],
        prefer: TIER_SETS.anime,
      }),
    ).toBeNull()
  })

  it('picks as pickMatch does in a library that prefers nothing, a lone result included', () => {
    const lone = result({ tmdbId: '7', title: 'Something Else', year: 1999 })
    const asked = { type: 'movie', title: 'The Matrix', year: 1999, results: [lone] } as const
    expect(pickByTiers({ ...asked, prefer: TIER_SETS.any })).toBe(pickMatch(asked))
    expect(pickByTiers({ ...asked, prefer: TIER_SETS.any })).toBe(lone)
    expect(pickByTiers({ ...asked, prefer: TIER_SETS.any, canTakeLoneResult: false })).toBeNull()
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/metadata/matcher.test.ts`
Expected: FAIL, `pickByTiers` is not exported.

- [ ] **Step 7: Write `pickByTiers`**

In `apps/raven/server/src/metadata/matcher.ts`, change the core import to:

```ts
import { type CandidateTier, fitsTier, foldTitle, isUnfiltered, type MatchItemType } from '@raven/core'
```

Append:

```ts
/**
 * `pickMatch` over each of a library's tiers in turn: the results that fit
 * the first, then the second, and so on, and the first pick wins. A lone
 * result in the name's year counts only in a tier that is every result, so
 * a filter that leaves one result never makes it a guess.
 */
export const pickByTiers = ({
  prefer,
  results,
  canTakeLoneResult = true,
  ...asked
}: Parameters<typeof pickMatch>[0] & {
  /** The library's tiers, from `tiersFor`. */
  prefer: readonly CandidateTier[]
}): SearchResult | null =>
  prefer.reduce<SearchResult | null>(
    (picked, tier) =>
      picked ??
      pickMatch({
        ...asked,
        results: results.filter((result) => fitsTier({ tier, result })),
        canTakeLoneResult: canTakeLoneResult && isUnfiltered(tier),
      }),
    null,
  )
```

- [ ] **Step 8: Run them to verify they pass**

Run: `bunx nx run @raven/server:test -- src/metadata/matcher.test.ts src/metadata/tmdbClient.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/raven/server/src/metadata/tmdbClient.ts apps/raven/server/src/metadata/tmdbClient.test.ts apps/raven/server/src/test/fakeTmdb.ts apps/raven/server/src/metadata/matcher.ts apps/raven/server/src/metadata/matcher.test.ts
git commit -m "MAE: raven picks a search result tier by tier" -m "- Search results keep TMDB's \`genre_ids\` and \`original_language\`
- \`pickByTiers\` runs \`pickMatch\` on each tier's results, taking a lone result only where nothing is filtered
- The fake TMDB sends both fields"
```

---

### Task 3: A pass prefers its library's results

**Files:**
- Modify: `apps/raven/server/src/metadata/matchPass.ts`
- Modify: `apps/raven/server/src/metadata/matchPass.test.ts`
- Modify: `apps/raven/server/src/metadata/matchers.test.ts` (its `pass` builder, near line 61)
- Modify: `apps/raven/server/src/metadata/metadataService.ts`

**Interfaces:**
- Consumes: `pickByTiers` (Task 2); `tiersFor`, `CandidateTier`, `TIER_SETS` (Task 1).
- Produces: `MatchPassDeps.prefer: readonly CandidateTier[]`. `MetadataService`'s private `newPass(kind: LibraryKind)`, `matchPending({ libraryId, kind, type })` and `pointPlace({ libraryId, kind, type, place, fix, files })`.

- [ ] **Step 1: Write the failing pass test**

In `apps/raven/server/src/metadata/matchPass.test.ts`:

Add to the first `describe`'s `fakeTmdb` `shows` list, after Severance:

```ts
      {
        id: 90660,
        title: 'Cowboy Bebop',
        first: '2021-11-19',
        genreIds: [10759, 18],
        language: 'en',
        countries: ['US'],
        seasons: {},
      },
      {
        id: 30991,
        title: 'Cowboy Bebop',
        first: '1998-04-03',
        genreIds: [16, 10759],
        language: 'ja',
        countries: ['JP'],
        seasons: {},
      },
```

Change its `pass` builder to take the tiers, defaulting to a library that prefers nothing:

```ts
  const pass = (prefer: readonly CandidateTier[] = TIER_SETS.any): MatchPass => {
    const config = { ...readServerConfig({}), tmdbApiToken: 'test-token' }
    const { metadata } = repositories(database.get())
    return new MatchPass({
      tmdb: new TmdbClient(config, tmdb.fetch),
      metadata,
      files: new MatchFiles(database.get(), metadata),
      scores: new OmdbScores(metadata, new OmdbClient(config, tmdb.fetch)),
      logger: new Logger('MatchPassTest'),
      prefer,
    })
  }
```

Add `import { type CandidateTier, TIER_SETS } from '@raven/core'`. Give the two other `new MatchPass({...})` calls in this file (near lines 241 and 296) `prefer: TIER_SETS.any`.

Add the test to the first `describe`:

```ts
  it("prefers the results its library's type does, from the same search", async () => {
    const asked = searches().length
    const ask = (prefer: readonly CandidateTier[]) =>
      pass(prefer).resolve({
        type: 'show',
        fix: { kind: 'none' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [{ title: 'Cowboy Bebop', year: null }],
      })
    await expect(ask(TIER_SETS.anime)).resolves.toMatchObject({
      kind: 'matched',
      tmdbId: '30991',
    })
    await expect(ask(TIER_SETS.any)).resolves.toMatchObject({ kind: 'matched', tmdbId: '90660' })
    expect(searches()).toHaveLength(asked + 2)
  })
```

In `apps/raven/server/src/metadata/matchers.test.ts`, add `prefer: TIER_SETS.any,` to its `new MatchPass({...})` and import `TIER_SETS` from `@raven/core`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx nx run @raven/server:test -- src/metadata/matchPass.test.ts`
Expected: FAIL: the anime pass resolves to `90660`, as `prefer` is not read yet.

- [ ] **Step 3: Read the tiers in the pass**

In `apps/raven/server/src/metadata/matchPass.ts`:

Add `type CandidateTier` to the `@raven/core` import, and change `import { pickMatch } from '@/metadata/matcher'` to `import { pickByTiers, pickMatch } from '@/metadata/matcher'` (`pickMatch` stays for the `Parameters` type).

Add to `MatchPassDeps`:

```ts
  /** The library's tiers, from `tiersFor`: every search in the pass prefers them in order. */
  prefer: readonly CandidateTier[]
```

In `search`, change the `pick` helper to:

```ts
        const pick = (
          extra: Omit<Parameters<typeof pickMatch>[0], 'type' | 'title' | 'year' | 'country'>,
        ): string | null =>
          pickByTiers({ type, title, year, country, prefer: this.deps.prefer, ...extra })
            ?.tmdbId ?? null
```

Add one line to the class comment: `A pass serves one library, so its searches, cached by title, are picked with that library's tiers.`

- [ ] **Step 4: Build each pass with its library's tiers**

In `apps/raven/server/src/metadata/metadataService.ts`:

Add `tiersFor` to the `@raven/core` import.

Replace `newPass`:

```ts
  /** A pass for a library of `kind`, whose searches prefer that type's results. */
  private newPass(kind: LibraryKind): MatchPass {
    return new MatchPass({
      tmdb: this.tmdb,
      metadata: this.metadata,
      files: this.files,
      scores: this.scores,
      logger: this.logger,
      prefer: tiersFor(kind),
    })
  }
```

Replace `pass`:

```ts
  private async pass(libraryId: number): Promise<void> {
    const kind = this.libraries.get(libraryId)?.settings.kind
    const type = kind == null ? null : matchTypeFor(kind)
    if (kind != null && type != null && this.tmdb.enabled) {
      this.tmdb.newPass()
      await this.matchPending({ libraryId, kind, type })
    }
    await this.pictures.clearUp()
  }
```

Change `matchPending`'s parameters to `{ libraryId, kind, type }: { libraryId: number; kind: LibraryKind; type: MatchItemType }` and its first line to `const pass = this.newPass(kind)`.

Change `pointPlace` to take `kind: LibraryKind` beside `type` (add it to the destructured object and its type), and its last line to `await this.matchers[type].match({ files, pass: this.newPass(kind) })`.

In `fixMatch`, narrow `kind` as well:

```ts
    if (file == null || kind == null || type == null) return
    const group = this.matchers[type].fixGroup(file)
    await this.pointPlace({
      libraryId: file.libraryId,
      kind,
      type,
      place: group.place,
      fix: tmdbId == null ? { kind: 'not-a-match' } : { kind: 'tmdb', tmdbId },
      files: group.files,
    })
```

In `fixShowMatch`, carry each group's library type, and leave a library that no longer lists shows alone:

```ts
    const groups = [
      ...groupBy({
        items: this.files.under(showId),
        key: (file) => `${file.libraryId}|${showPlace(file)}`,
      }).values(),
    ].flatMap((files) => {
      const [first] = files
      const kind = first == null ? null : this.libraries.get(first.libraryId)?.settings.kind
      // A library whose type changed away from shows has its files unlinked by that change.
      return first != null && kind != null && matchTypeFor(kind) === 'show'
        ? [{ first, kind, files }]
        : []
    })
    await groups.reduce<Promise<void>>(
      (previous, { first, kind, files }) =>
        previous.then(() =>
          this.pointPlace({
            libraryId: first.libraryId,
            kind,
            type: 'show',
            place: showPlace(first),
            fix: { kind: 'tmdb', tmdbId },
            files,
          }),
        ),
      Promise.resolve(),
    )
```

- [ ] **Step 5: Run the metadata tests and the typecheck**

Run: `bunx nx run @raven/server:test -- src/metadata` then `bunx nx run @raven/server:typecheck`
Expected: PASS. `shows.test.ts` and `movies.test.ts` still pass, as their libraries are TV shows and Movies, and their two Anime cases still change nothing, since the controller does not rematch yet.

- [ ] **Step 6: Commit**

```bash
git add apps/raven/server/src/metadata/matchPass.ts apps/raven/server/src/metadata/matchPass.test.ts apps/raven/server/src/metadata/matchers.test.ts apps/raven/server/src/metadata/metadataService.ts
git commit -m "MAE: raven matches each library preferring its type's results" -m "- A \`MatchPass\` is built with its library's tiers; searches, alias lookups and the adult retry pick through them
- \`MetadataService\` hands the library's type down to every pass and Fix match"
```

---

### Task 4: A type that prefers other results matches again

**Files:**
- Modify: `apps/raven/server/src/libraries/librariesController.ts` (`update`, near line 180)
- Modify: `apps/raven/server/src/metadata/metadataService.ts` (`changeKind`'s comment)
- Modify: `apps/raven/server/src/metadata/movies.test.ts` (near line 744)
- Modify: `apps/raven/server/src/metadata/shows.test.ts` (near line 257)
- Create: `apps/raven/server/src/metadata/libraryTypes.test.ts`
- Modify: `apps/raven/README.md`

**Interfaces:**
- Consumes: `matchesAlike` (Task 1); the tier-aware pass (Task 3); `FakeShow.genreIds` and `language` (Task 2).
- Produces: `libraryTypes.test.ts`, with a `describe('matching by library type')` that Task 5 adds a test to. Its `state` holds `library: number` (the TV library's id) and `tv: string` (its path), and it has the helpers `setKind(kind: string): Promise<void>` (PUT then settle) and `showYears(): Promise<Array<number | null>>`.

- [ ] **Step 1: Write the failing end to end test**

Create `apps/raven/server/src/metadata/libraryTypes.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isLibrary, isShowListing } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { encodeClip } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = {
  statusCode: number
  rawPayload: Buffer
  json: () => unknown
}

const shape = <T>({
  response,
  guard,
}: {
  response: Injected
  guard: (value: unknown) => value is T
}): T => {
  const body: unknown = response.json()
  if (!guard(body)) throw new Error(`Unexpected body: ${response.rawPayload.toString()}`)
  return body
}

describe('matching by library type', () => {
  // The live-action series is listed first, as TMDB lists the more popular one.
  const tmdb = fakeTmdb({
    shows: [
      {
        id: 90660,
        title: 'Cowboy Bebop',
        first: '2021-11-19',
        genreIds: [10759, 18],
        language: 'en',
        countries: ['US'],
        seasons: { 1: [{ number: 1, title: 'Cowboy Gospel', aired: '2021-11-19' }] },
      },
      {
        id: 30991,
        title: 'Cowboy Bebop',
        first: '1998-04-03',
        genreIds: [16, 10759],
        language: 'ja',
        countries: ['JP'],
        seasons: { 1: [{ number: 1, title: 'Asteroid Blues', aired: '1998-10-24' }] },
      },
    ],
  })
  const state: {
    root: string
    tv: string
    data: string
    app: NestFastifyApplication | null
    library: number
  } = { root: '', tv: '', data: '', app: null, library: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const settle = async () => {
    await app().get(ScannerService).whenIdle(state.library)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const setKind = async (kind: string): Promise<void> => {
    await app().inject({
      method: 'PUT',
      url: `/api/libraries/${state.library}`,
      payload: { name: 'TV', paths: [state.tv], settings: { kind } },
    })
    await settle()
  }
  const showYears = async (): Promise<Array<number | null>> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.library}/shows`,
      }),
      guard: isShowListing,
    }).shows.map((entry) => entry.show.year)

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-types-'))
    state.tv = join(state.root, 'TV')
    state.data = join(state.root, 'data')
    await encodeClip({
      path: join(state.tv, 'Cowboy Bebop', 'Season 1', 'Cowboy Bebop - S01E01 - Asteroid Blues.mp4'),
      seconds: 1,
    })
    state.app = await createApp({
      config: {
        ...readServerConfig({}),
        hwAccel: 'none',
        dataDir: state.data,
        webDir: null,
        browseRoot: state.root,
        scanOnStart: false,
        rescanIntervalMinutes: 0,
        tmdbApiToken: 'test-token',
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.library = shape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'TV', paths: [state.tv], settings: { kind: 'shows' } },
      }),
      guard: isLibrary,
    }).id
    await settle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('matches the more popular series in a TV library', async () => {
    expect(await showYears()).toEqual([2021])
  })

  it('matches the anime again once the library is Anime shows, and the series once it is TV again', async () => {
    await setKind('animeShows')
    expect(await showYears()).toEqual([1998])
    await setKind('shows')
    expect(await showYears()).toEqual([2021])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx nx run @raven/server:test -- src/metadata/libraryTypes.test.ts`
Expected: the first test PASSES, the second FAILS with `[2021]` where `[1998]` was expected, as changing TV shows to Anime shows rematches nothing yet.

- [ ] **Step 3: Rematch when the type prefers other results**

In `apps/raven/server/src/libraries/librariesController.ts`, add `matchesAlike` to the `@raven/core` import (drop `matchTypeFor` from it only if nothing else in the file still uses it; `rematch` and others do, so it stays).

Change `update`'s comment and its first branch:

```ts
  /**
   * Only a change of folders rescans. A change of type that reads files
   * another way or prefers other results, or of folder layout, reads them
   * again and matches what regrouped. A rename or another setting, the lock
   * included, leaves the index as it is.
   */
```

```ts
    if (!matchesAlike({ before: before.settings.kind, after: record.settings.kind })) {
      this.metadata.changeKind({ libraryId: id, kind: record.settings.kind })
    } else if (before.settings.folderLayout !== record.settings.folderLayout) {
```

In `metadataService.ts`, change `changeKind`'s comment to:

```ts
  /**
   * A library's type changed to one that reads or picks its files another
   * way: every file's name is read again for the new type and matched from
   * scratch, preferring the new type's results, or left off for a type that
   * is not matched. Fix match choices stay.
   */
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx nx run @raven/server:test -- src/metadata/libraryTypes.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the two cases that pinned the old behaviour**

Run: `bunx nx run @raven/server:test -- src/metadata/movies.test.ts src/metadata/shows.test.ts`
Expected: FAIL in `'keeps every match when the type changes to Anime movies, which is matched the same way'` and `'keeps every match as an Anime shows library, listed and shelved as its shows'`, as both now search again.

In `movies.test.ts`, replace the first with:

```ts
  it('matches again when the type changes to Anime movies, keeping what it found and every Fix match', async () => {
    const matches = async () =>
      (await list()).map((item) => [item.fileName, item.match, item.item?.title ?? null])
    const before = await matches()
    const asked = tmdb.state.calls.length
    expect((await setKind('animeMovies')).settings).toMatchObject({ kind: 'animeMovies' })
    await settle()
    // Nothing here is animation, so every search falls through to the same pick.
    expect(await matches()).toEqual(before)
    expect(
      (await list()).find((item) => item.title === 'Unknown Thing'),
    ).toMatchObject({ match: 'manual', item: { title: 'Unknown Thing Two' } })
    const searched = tmdb.state.calls.length
    expect(searched).toBeGreaterThan(asked)
    await setKind('movies')
    await settle()
    expect(await matches()).toEqual(before)
    expect(tmdb.state.calls.length).toBeGreaterThan(searched)
  })
```

Check, before relying on it, that `'Unknown Thing'` holds a manual match at this point in the file (the earlier `'keeps a Fix match through a rename'` case sets it); the later `'matches again when the type changes, and goes back to file names for Other'` case asserts the same. If the file's order leaves it unset here, drop that one assertion.

In `shows.test.ts`, replace the second with:

```ts
  it('matches again as an Anime shows library, listed and shelved as its shows', async () => {
    const setKind = async (kind: string) => {
      await app().inject({
        method: 'PUT',
        url: `/api/libraries/${state.library}`,
        payload: { name: 'TV', paths: [state.media], settings: { kind } },
      })
      await settle()
    }
    const before = await shows()
    const asked = tmdb.state.calls.length
    await setKind('animeShows')
    // None of these shows is animation, so each search falls through to the same pick.
    expect(await shows()).toEqual(before)
    const searched = tmdb.state.calls.length
    expect(searched).toBeGreaterThan(asked)
    const home = shape({
      response: await app().inject({ method: 'GET', url: '/api/home' }),
      guard: isHome,
    })
    expect(home.shelves.find((shelf) => shelf.libraryId === state.library)?.type).toBe('shows')
    await setKind('shows')
    expect(await shows()).toEqual(before)
    expect(tmdb.state.calls.length).toBeGreaterThan(searched)
  })
```

If `shows()` returns fields that change on a rematch (an `addedAt`, a link id), compare `(await shows()).shows.map((entry) => [entry.show.title, entry.episodes])` plus `unmatched.map((entry) => entry.fileName)` instead, and say so in the report. Do not loosen anything else.

- [ ] **Step 6: Run them to verify they pass**

Run: `bunx nx run @raven/server:test -- src/metadata/movies.test.ts src/metadata/shows.test.ts src/metadata/libraryTypes.test.ts`
Expected: PASS.

- [ ] **Step 7: Say it in the README**

In `apps/raven/README.md`:

In the **Type** bullet (near line 120), replace the sentence `Changing the type matches the files again, or goes back to plain file names; a change between two types read the same way (Movies and Documentaries, say, or Sporting events and Other) keeps every match.` with:

```
Changing the type matches the files again, or goes back to plain file names; Fix match choices stay. Only a change between two types that are never matched (Sporting events, YouTube videos and Other) leaves the files as they are.
```

In the **Matching** bullet (near line 178), after `raven never guesses at a different title.`, add:

```
A library's type steers which result that is: an Anime library takes Japanese animation first, then any animation, then anything else with the title; a Family library takes family films and animation first; and a Documentaries library takes documentaries first. So `Cowboy Bebop/` is the 1998 anime in an Anime shows library, and the more popular 2021 series in a TV shows one.
```

- [ ] **Step 8: Commit**

```bash
git add apps/raven/server/src/libraries/librariesController.ts apps/raven/server/src/metadata/metadataService.ts apps/raven/server/src/metadata/movies.test.ts apps/raven/server/src/metadata/shows.test.ts apps/raven/server/src/metadata/libraryTypes.test.ts apps/raven/README.md
git commit -m "MAE: raven matches again when a library's type prefers other results" -m "- Movies to Anime movies, or TV shows to Documentaries, now rematches; Fix match choices stay
- End to end: Cowboy Bebop is the 1998 anime in Anime shows and the 2021 series in TV shows
- README: what a type change rematches, and how types steer matching"
```

---

### Task 5: Fix match lists the library's preferred results first

**Files:**
- Modify: `apps/raven/server/src/items/matchController.ts`
- Modify: `apps/raven/server/src/metadata/libraryTypes.test.ts`
- Modify: `libs/raven/core/src/apiClient.ts` (`searchMatches`, near line 502)
- Modify: `libs/raven/core/src/apiClient.test.ts` (near line 384)
- Modify: `apps/raven/web/src/lib/queryClient.ts` (`matchSearch`, near line 106)
- Modify: `apps/raven/web/src/lib/queries.ts` (`matchSearchQuery`, near line 169)
- Modify: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.tsx`
- Modify: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.test.tsx`
- Modify: `apps/raven/web/src/components/MediaMenu/MediaMenu.tsx` (near line 334)
- Modify: `apps/raven/web/src/components/UnmatchedShows/UnmatchedShows.tsx` (near line 62)
- Modify: `apps/raven/README.md`

**Interfaces:**
- Consumes: `firstTierFor`, `fitsTier`, `CandidateTier` (Task 1); `SearchResult.genreIds`/`originalLanguage` (Task 2); `libraryTypes.test.ts`'s `state`, `setKind` (Task 4).
- Produces: `GET /api/match/search?...&libraryId=<id>`; `api.searchMatches({ type, query, year, libraryId })`; `matchSearchQuery({ type, query, year, libraryId })`; `queryKeys.matchSearch({ type, query, year, libraryId })`; `FixMatchDialog`'s `libraryId?: number` prop.

- [ ] **Step 1: Write the failing server test**

Add `isMatchCandidateList` to `libraryTypes.test.ts`'s `@raven/core` import, and append inside its `describe`:

```ts
  it("lists the results a library's type prefers first in Fix match", async () => {
    const order = async (query: string): Promise<string[]> =>
      shape({
        response: await app().inject({
          method: 'GET',
          url: `/api/match/search?type=show&query=Cowboy%20Bebop${query}`,
        }),
        guard: isMatchCandidateList,
      }).map((each) => each.tmdbId)
    await setKind('animeShows')
    expect(await order(`&libraryId=${state.library}`)).toEqual(['30991', '90660'])
    expect(await order('')).toEqual(['90660', '30991'])
    // A library removed while the dialog was open lists TMDB's order.
    expect(await order('&libraryId=9999')).toEqual(['90660', '30991'])
    await setKind('shows')
    expect(await order(`&libraryId=${state.library}`)).toEqual(['90660', '30991'])
  })

  it('refuses a library id that is not one', async () => {
    const response = await app().inject({
      method: 'GET',
      url: '/api/match/search?type=show&query=Cowboy%20Bebop&libraryId=abc',
    })
    expect(response.statusCode).toBe(400)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx nx run @raven/server:test -- src/metadata/libraryTypes.test.ts`
Expected: FAIL: the anime library's search lists `['90660', '30991']`, and `abc` answers 200.

- [ ] **Step 3: Sort by the library's first tier**

In `apps/raven/server/src/items/matchController.ts`, add `type CandidateTier`, `firstTierFor` and `fitsTier` to the `@raven/core` import.

Change `search`:

```ts
  /**
   * TMDB's results for Fix match. With `libraryId`, those that fit the
   * library type's first tier (Japanese animation in an Anime library) come
   * first, each part in TMDB's order.
   */
  @Get('match/search')
  async search(
    @Query('type') type: string | undefined,
    @Query('query') query: string | undefined,
    @Query('year') year: string | undefined,
    @Query('libraryId') libraryId: string | undefined,
  ): Promise<MatchCandidate[]> {
    if (!isMatchItemType(type)) throw new BadRequestException('type must be movie or show')
    if (!query?.trim()) throw new BadRequestException('Search for a title.')
    const preferred = this.preferredBy(libraryId)
    this.requireTmdb()
    const parsedYear = Number.parseInt(year ?? '', 10)
    const asked = { query: query.trim(), year: Number.isInteger(parsedYear) ? parsedYear : null }
    const results = await (
      type === 'movie' ? this.tmdb.searchMovies(asked) : this.tmdb.searchShows(asked)
    ).catch(tmdbFailure)
    const rank = (result: SearchResult): number =>
      fitsTier({ tier: preferred, result }) ? 0 : 1
    return results
      .toSorted((a, b) => rank(a) - rank(b))
      .map(({ tmdbId, title, year: released, overview, poster }) => ({
        tmdbId,
        title,
        year: released,
        overview,
        poster,
      }))
  }

  /** The tier a library's type prefers first; every result for no library, or one raven no longer has. */
  private preferredBy(libraryId: string | undefined): CandidateTier {
    if (libraryId == null) return {}
    if (!/^\d+$/.test(libraryId)) throw new BadRequestException('libraryId must be a library id')
    const kind = this.libraries.get(Number(libraryId))?.settings.kind
    return kind == null ? {} : firstTierFor(kind)
  }
```

Import `type SearchResult` from `@/metadata/tmdbClient` beside `TmdbClient`.

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx nx run @raven/server:test -- src/metadata/libraryTypes.test.ts src/metadata/movies.test.ts src/metadata/shows.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing client and dialog tests**

In `libs/raven/core/src/apiClient.test.ts`, after `'searches TMDB through the server with the year when there is one'`, add:

```ts
  it("names the library a search is for, so its type's results come first", async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await client.searchMatches({ type: 'show', query: 'Cowboy Bebop', year: null, libraryId: 3 })
    expect(calls[0]?.url).toBe(
      'http://nas:8484/api/match/search?type=show&query=Cowboy%20Bebop&libraryId=3',
    )
  })
```

In `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.test.tsx`, in `'searches with the parsed title and year, and points the file at the choice'`, record the library too:

```ts
    const searched: Array<{ query: string; year?: number | null; libraryId?: number | null }> = []
    spies.search.mockImplementation(async (request) => {
      searched.push({ query: request.query, year: request.year, libraryId: request.libraryId })
```

and change its assertion to:

```ts
    expect(searched).toEqual([{ query: 'Busboys', year: 2026, libraryId: unmatched.libraryId }])
```

- [ ] **Step 6: Run them to verify they fail**

Run: `bunx nx run @raven/core:test -- src/apiClient.test.ts` and `bunx nx run @raven/web:test -- src/components/FixMatchDialog/FixMatchDialog.test.tsx`
Expected: FAIL: the URL has no `libraryId`, and the dialog searches without one.

- [ ] **Step 7: Send the library from the client and the dialog**

In `libs/raven/core/src/apiClient.ts`, change `searchMatches`:

```ts
    /** TMDB's results for Fix match, those `libraryId`'s type prefers first. */
    searchMatches: ({
      type,
      query,
      year,
      libraryId,
    }: {
      type: MatchItemType
      query: string
      year?: number | null
      libraryId?: number | null
    }): Promise<MatchCandidate[]> =>
      expect({
        request: send({
          path: `/api/match/search?${toQueryString({
            type,
            query: query.trim(),
            ...(year == null ? {} : { year: String(year) }),
            ...(libraryId == null ? {} : { libraryId: String(libraryId) }),
          })}`,
        }),
        guard: isMatchCandidateList,
      }),
```

In `apps/raven/web/src/lib/queryClient.ts`, change `matchSearch`:

```ts
  matchSearch: ({
    type,
    query,
    year,
    libraryId,
  }: {
    type: MatchItemType
    query: string
    year: number | null
    libraryId: number | null
  }) => ['match', type, query, year, libraryId],
```

In `apps/raven/web/src/lib/queries.ts`, change `matchSearchQuery`:

```ts
/** A search for Fix match, the library's preferred results first; an empty title asks for nothing. */
export const matchSearchQuery = ({
  type,
  query,
  year,
  libraryId,
}: {
  type: MatchItemType
  query: string
  year: number | null
  libraryId: number | null
}) =>
  queryOptions({
    queryKey: queryKeys.matchSearch({ type, query, year, libraryId }),
    queryFn:
      query === '' ? skipToken : () => api.searchMatches({ type, query, year, libraryId }),
    staleTime: 5 * 60_000,
  })
```

In `FixMatchDialog.tsx`, add the prop after `fileName` in the destructuring and its type:

```ts
  /** The library the file is in: the results its type prefers are listed first. */
  libraryId?: number
```

and change the query:

```ts
  const results = useQuery(
    matchSearchQuery({ type, query: asked.query, year: asked.year, libraryId: libraryId ?? null }),
  )
```

In `MediaMenu.tsx`, pass `libraryId={media.libraryId}` to `FixMatchDialog`. In `UnmatchedShows.tsx`, pass `libraryId={first.libraryId}`. `ShowPage.tsx` passes none, as a show's files can sit in several libraries.

- [ ] **Step 8: Run them to verify they pass**

Run: `bunx nx run @raven/core:test` and `bunx nx run @raven/web:test`
Expected: PASS.

- [ ] **Step 9: Say it in the README**

In `apps/raven/README.md`'s **Fix match** bullet (near line 187), after `or say it is not a movie.`, add: `The results a library's type prefers, Japanese animation in an Anime library say, are listed first.`

- [ ] **Step 10: Commit**

```bash
git add apps/raven/server/src/items/matchController.ts apps/raven/server/src/metadata/libraryTypes.test.ts libs/raven/core/src/apiClient.ts libs/raven/core/src/apiClient.test.ts apps/raven/web/src/lib/queryClient.ts apps/raven/web/src/lib/queries.ts apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.tsx apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.test.tsx apps/raven/web/src/components/MediaMenu/MediaMenu.tsx apps/raven/web/src/components/UnmatchedShows/UnmatchedShows.tsx apps/raven/README.md
git commit -m "MAE: raven's Fix match lists what the library's type prefers first" -m "- \`GET /api/match/search\` takes \`libraryId\`, and sorts the results that fit its type's first tier ahead
- A file's menu and an unmatched show's entry search for their library"
```

---

### Task 6: Verify the branch

**Files:** none new.

- [ ] **Step 1: Run every check**

Run: `bun run verify`
Expected: every project passes lint, format, typecheck, tests and build. Fix what fails in the task it belongs to, with its own commit.

- [ ] **Step 2: Check the diff for the rules a linter misses**

Run: `git diff raven-smart-scan-layout --stat` and read the whole diff once for: an em or en dash, a positional second parameter, a `for` loop, a cast, an `||` default, a comment that restates the code.

- [ ] **Step 3: Push and open the PR**

Push `raven-smart-scan-types` and open the PR with base `raven-smart-scan-layout`, following the `pr-format` skill: a `MAE:` title, `Stacked on #135.` first, then What, Why and Testing by Nx project. Why: the spec's S2 outcome (Avatar: The Last Airbender picked the 2024 live-action series in Anime Shows), and Movies to Anime movies rematching nothing. Follow-ups: on Vhagar, changing nothing changes nothing, as Anime Shows is already an Anime library and its next pass after deploy does not rematch on its own; **Match again** on Anime Shows only retries unmatched files, so a wrong pick made before this step stays until a Fix match, or until the type is switched away and back.
