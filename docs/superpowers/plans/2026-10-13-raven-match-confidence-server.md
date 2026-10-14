# raven match confidence, step 1: scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix match's search answers every result with a `confidence` from 0 to 100, best first, scored from the title, the year, what the folder or file holds on disk, the library's type and popularity.

**Architecture:**
- `@raven/core` holds the tiers (`confidenceTierOf`, 80 and 50), `isMatchCandidate.confidence` and `isMatchSubject`; `api.searchMatches` takes an optional `subject`.
- `scoreCandidates` (server, pure) turns the search results, the searched title and year, the library tier, what is on disk and the details read for some results into one confidence each.
- `TmdbClient.matchFacts` reads one result's details (`/tv/{id}` or `/movie/{id}` with `alternative_titles`); `MatchFactsCache` keeps them a day.
- `MatchController.search` resolves the subject behind the lock, scores once, reads the top five's details, scores again and sorts best first, stable over today's order.

**Tech Stack:** NestJS 12 on Fastify, vitest (server); bun test (core); TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-13-raven-match-confidence-design.md`: "Scoring", "API", "Server", the core and server parts of "Testing", and "Order of work" step 1.

## Global Constraints

- Every rule in the root `CLAUDE.md` holds:
  - no `any`, no casts (`as const` is fine), no non-null assertions outside tests, no `@ts-ignore`;
  - `type`, never `interface`; no enums;
  - named exports only;
  - no `for`, `for...of` or `for...in` loops: array methods, `reduce` to accumulate;
  - one object parameter wherever there are two or more;
  - `@/` imports with no extension;
  - switch on a discriminant with a `never` exhaustiveness check in `default`;
  - booleans named `is`, `has`, `should`, `can`;
  - no em or en dashes anywhere, comments included.
- raven: an API shape is a guard in `libs/raven/core/src/contract.ts` and its type is `Infer<typeof isX>`; `libs/raven/core` stays platform-agnostic (no DOM, no Node, no `URLSearchParams`); server constructors inject with explicit `@Inject(Token)`.
- The numbers, binding from the spec: tiers Strong from 80, Possible from 50; `score = round(100 × title × (0.6 + 0.4 × support))`; partial title `0.8 × (1 − edit distance / longer length)`; support weights year 30, fit 20, library type 5, popularity 5; year steps 1, 0.8 (one off), 0.4 (within three), 0; movie fit 1 within 10 minutes, 0.5 within 25, else 0; a fit of 0 or another country caps at 40; close call: top at 80 or more with another within 10 caps every one within 10 at 79; details for the top five, kept a day, at most 500.
- Run tasks through Nx from the repo root:
  - `bunx nx run @raven/core:test`, `bunx nx run @raven/server:test`, `bunx nx run @raven/web:test`;
  - one server file: `bunx nx run @raven/server:test -- src/metadata/matchConfidence.test.ts`;
  - one core file: `bunx nx run @raven/core:test -- src/matchConfidence.test.ts`;
  - `bunx nx run-many -t typecheck lint:ts -p @raven/core @raven/server @raven/web`;
  - `bunx nx run-many -t format -p @raven/core @raven/server @raven/web` before every commit;
  - `bun run verify` before the PR.
- Commits follow the `commit-format` skill: a `MAE:` subject, a short bullet body written with a heredoc, backticks around code, and no agent attribution. That skill forbids naming the assistant's vendor anywhere in a commit, so say "the AI lookup", never the vendor, the model or the assistant.
- Branch: `raven-match-confidence-server`, off `main`. This step is the first PR of a stack of two.

## Review Focus

- **A search in a script `foldTitle` drops** (몬스터, モンスター): `foldTitle` keeps only `a-z0-9`, so every such title folds to `''`. Expect the lower-cased text compared instead, so not every result is an exact title. Pinned in Task 1.
- **A subject in a library the browser may not see**: expect the answer to be what it would be with no subject, so the scores never tell a hidden library is there. Pinned in Task 3.
- **TMDB failing on a details call after the search answered**: expect the search to answer, that result scored without fit or aliases. Pinned in Task 3.
- **An unprobed movie (no duration) or a show folder whose files carry no episode numbers**: expect no fit measured, never a fit of 0 that caps the right result at 40. Pinned in Task 1.
- **Two results scoring exactly the same**: expect today's order (library tier first, then TMDB's) between them, since `toSorted` is stable. Pinned in Task 3 by the existing `libraryTypes.test.ts` order test, which must keep passing unchanged.

---

### Task 1: The tiers and `scoreCandidates`

**Files:**
- Create: `libs/raven/core/src/matchConfidence.ts`
- Create: `libs/raven/core/src/matchConfidence.test.ts`
- Modify: `libs/raven/core/src/index.ts` (export the new module, in alphabetical order after `@/libraryKinds`)
- Create: `apps/raven/server/src/metadata/matchConfidence.ts`
- Create: `apps/raven/server/src/metadata/matchConfidence.test.ts`
- Modify: `apps/raven/server/src/metadata/tmdbClient.ts` (add the `MatchFacts` type only, beside `SearchResult`; its reader comes in Task 2)

**Interfaces:**
- Produces (core): `isConfidenceTier`, `ConfidenceTier` (`'strong' | 'possible' | 'weak'`), `CONFIDENCE_STRONG = 80`, `CONFIDENCE_POSSIBLE = 50`, `confidenceTierOf(confidence: number): ConfidenceTier`.
- Produces (server, `@/metadata/tmdbClient`): `MatchFacts = { type: 'show'; aliases: string[]; seasons: Array<{ number: number; episodeCount: number }>; episodeCount: number | null } | { type: 'movie'; aliases: string[]; runtime: number | null }` (runtime in minutes).
- Produces (server, `@/metadata/matchConfidence`): `EpisodeNumbers`, `OnDisk`, and `scoreCandidates({ title, year, country, results, tier, onDisk, facts }): number[]`, one confidence per result in the order given.

- [ ] **Step 1: Write the failing core test**

`libs/raven/core/src/matchConfidence.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { confidenceTierOf, isConfidenceTier } from '@/matchConfidence'

describe('confidence tiers', () => {
  it('reads Strong from 80, Possible from 50 and Weak below', () => {
    expect([0, 49, 50, 79, 80, 100].map(confidenceTierOf)).toEqual([
      'weak',
      'weak',
      'possible',
      'possible',
      'strong',
      'strong',
    ])
  })

  it('knows its tiers', () => {
    expect(isConfidenceTier.values).toEqual(['strong', 'possible', 'weak'])
    expect(isConfidenceTier('sure')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `bunx nx run @raven/core:test -- src/matchConfidence.test.ts`
Expected: FAIL, `Cannot find module '@/matchConfidence'`.

- [ ] **Step 3: Write the core module**

`libs/raven/core/src/matchConfidence.ts`:

```ts
import { type Infer, oneOf } from '@/schema'

/** How sure Fix match is that a result is the folder's or file's movie or show. */
export const isConfidenceTier = oneOf(['strong', 'possible', 'weak'])

export type ConfidenceTier = Infer<typeof isConfidenceTier>

/** The lowest Strong confidence, the only tier Fix match names a best match in. */
export const CONFIDENCE_STRONG = 80

/** The lowest Possible confidence; below it a result is Weak. */
export const CONFIDENCE_POSSIBLE = 50

export const confidenceTierOf = (confidence: number): ConfidenceTier => {
  if (confidence >= CONFIDENCE_STRONG) return 'strong'
  if (confidence >= CONFIDENCE_POSSIBLE) return 'possible'
  return 'weak'
}
```

Add `export * from '@/matchConfidence'` to `libs/raven/core/src/index.ts` after `export * from '@/libraryKinds'`.

- [ ] **Step 4: Run the core test to see it pass**

Run: `bunx nx run @raven/core:test -- src/matchConfidence.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the `MatchFacts` type**

In `apps/raven/server/src/metadata/tmdbClient.ts`, after the `SearchResult` type:

```ts
/**
 * What Fix match's confidence reads of a result that TMDB's search does not
 * give: a show's seasons and episode counts, or a movie's runtime in
 * minutes, and the other titles TMDB knows it by.
 */
export type MatchFacts =
  | {
      type: 'show'
      aliases: string[]
      seasons: Array<{ number: number; episodeCount: number }>
      episodeCount: number | null
    }
  | { type: 'movie'; aliases: string[]; runtime: number | null }
```

- [ ] **Step 6: Write the failing scoring tests**

`apps/raven/server/src/metadata/matchConfidence.test.ts`:

```ts
import { type CandidateTier, TIER_SETS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { type EpisodeNumbers, type OnDisk, scoreCandidates } from '@/metadata/matchConfidence'
import type { MatchFacts, SearchResult } from '@/metadata/tmdbClient'

const result = (
  fields: Pick<SearchResult, 'tmdbId' | 'title'> & Partial<SearchResult>,
): SearchResult => ({
  originalTitle: null,
  year: null,
  overview: null,
  poster: null,
  popularity: null,
  countries: [],
  genreIds: [],
  originalLanguage: null,
  ...fields,
})

const show = (fields: Partial<Extract<MatchFacts, { type: 'show' }>>): MatchFacts => ({
  type: 'show',
  aliases: [],
  seasons: [],
  episodeCount: null,
  ...fields,
})

const movie = (fields: Partial<Extract<MatchFacts, { type: 'movie' }>>): MatchFacts => ({
  type: 'movie',
  aliases: [],
  runtime: null,
  ...fields,
})

const episodes = (season: number, ...numbers: number[]): EpisodeNumbers[] =>
  numbers.map((episode) => ({ season, episodes: [episode], absolute: null }))

const ANY = TIER_SETS.any[0]

const score = ({
  title,
  year = null,
  country = null,
  results,
  tier = ANY,
  onDisk = null,
  facts = new Map(),
}: {
  title: string
  year?: number | null
  country?: string | null
  results: SearchResult[]
  tier?: CandidateTier
  onDisk?: OnDisk | null
  facts?: Map<string, MatchFacts>
}): number[] => scoreCandidates({ title, year, country, results, tier, onDisk, facts })

describe('scoreCandidates', () => {
  it('scores an exact title with nothing else to go on 100', () => {
    expect(score({ title: 'Severance', results: [result({ tmdbId: '1', title: 'Severance' })] })).toEqual([100])
  })

  it('counts the original title and an alias as the title', () => {
    const results = [
      result({ tmdbId: '1', title: 'Spirited Away', originalTitle: 'Sen to Chihiro no Kamikakushi' }),
      result({ tmdbId: '2', title: 'Loveland' }),
    ]
    expect(
      score({
        title: 'Sen to Chihiro no Kamikakushi',
        results: results.slice(0, 1),
      }),
    ).toEqual([100])
    expect(
      score({
        title: 'Expired',
        results: results.slice(1),
        facts: new Map([['2', movie({ aliases: ['Expired'] })]]),
      }),
    ).toEqual([100])
  })

  it('scores a typo Possible and extra words Weak, by edit distance', () => {
    expect(score({ title: 'Wild Arctik', results: [result({ tmdbId: '1', title: 'Wild Arctic' })] })).toEqual([73])
    expect(
      score({
        title: 'Monster',
        results: [
          result({ tmdbId: '1', title: 'Monster High' }),
          result({ tmdbId: '2', title: 'Monster: The Lizzie Borden Story' }),
        ],
      }),
    ).toEqual([47, 18])
  })

  it('compares a title with no Latin letters as it is written', () => {
    expect(
      score({
        title: '몬스터',
        results: [result({ tmdbId: '1', title: '몬스터' }), result({ tmdbId: '2', title: '괴물' })],
      }),
    ).toEqual([100, 0])
  })

  it('steps the year down one, three and more years off, and marks a result with no year down', () => {
    const results = [2020, 2021, 2023, 2026].map((year, index) =>
      result({ tmdbId: String(index), title: `Heat ${index}`, year }),
    )
    // Each title is 'heat n' against 'heat n': exact, so only the year moves the score.
    const scored = results.map((each, index) =>
      score({ title: `Heat ${index}`, year: 2020, results: [each] })[0],
    )
    expect(scored).toEqual([100, 92, 76, 60])
    expect(score({ title: 'Heat', year: 2020, results: [result({ tmdbId: '9', title: 'Heat' })] })).toEqual([60])
  })

  it('averages the support over only what it can measure', () => {
    // Year 2021 (0.8 of 30) with a fit (1 of 20): (24 + 20) / 50 = 0.88.
    expect(
      score({
        title: 'Short Film',
        year: 2020,
        results: [result({ tmdbId: '1', title: 'Short Film', year: 2021 })],
        onDisk: { type: 'movie', duration: 95 * 60 },
        facts: new Map([['1', movie({ runtime: 100 })]]),
      }),
    ).toEqual([95])
  })

  it('weighs popularity only between results that share the title', () => {
    // A more popular show by another name never marks the lone exact title down.
    expect(
      score({
        title: 'Patriot',
        results: [
          result({ tmdbId: '1', title: 'Patriot Games', popularity: 90 }),
          result({ tmdbId: '2', title: 'Patriot', popularity: 10 }),
        ],
      }),
    ).toEqual([43, 100])
    // Two exact titles: the less popular one is marked down by how much less.
    expect(
      score({
        title: 'Patriot',
        results: [
          result({ tmdbId: '1', title: 'The Patriot', popularity: 90 }),
          result({ tmdbId: '2', title: 'Patriot', popularity: 10 }),
        ],
      }),
    ).toEqual([100, 64])
  })

  it("prefers the library type's first tier", () => {
    const results = [
      result({ tmdbId: '90660', title: 'Cowboy Bebop', genreIds: [10759, 18], originalLanguage: 'en' }),
      result({ tmdbId: '30991', title: 'Cowboy Bebop', genreIds: [16], originalLanguage: 'ja', countries: ['JP'] }),
    ]
    expect(score({ title: 'Cowboy Bebop', results, tier: TIER_SETS.anime[0] })).toEqual([60, 100])
  })

  describe('a show folder', () => {
    const monster = [
      result({ tmdbId: '30981', title: 'Monster', year: 2004, popularity: 50 }),
      result({ tmdbId: '65806', title: 'Monster', year: 2016, popularity: 10 }),
      result({ tmdbId: '131532', title: 'Monster High', year: 2022, popularity: 80 }),
      result({ tmdbId: '299939', title: 'Monster: The Lizzie Borden Story', year: 2026 }),
    ]
    const facts = new Map<string, MatchFacts>([
      ['30981', show({ seasons: [{ number: 1, episodeCount: 74 }], episodeCount: 74 })],
      ['65806', show({ seasons: [{ number: 1, episodeCount: 50 }], episodeCount: 50 })],
      ['131532', show({ seasons: [{ number: 1, episodeCount: 13 }], episodeCount: 13 })],
    ])
    const onDisk: OnDisk = { type: 'show', files: episodes(1, 1, 2, 35) }

    it('makes the spec example a close call, both Possible, and the rest Weak', () => {
      expect(score({ title: 'Monster', results: monster, onDisk, facts })).toEqual([79, 79, 28, 18])
    })

    it('names the more popular the winner when nothing is on disk', () => {
      expect(score({ title: 'Monster', results: monster })).toEqual([100, 68, 47, 18])
    })

    it('caps a show without an episode on disk at 40', () => {
      const wrong = new Map<string, MatchFacts>([
        ['30981', show({ seasons: [{ number: 1, episodeCount: 20 }], episodeCount: 20 })],
      ])
      expect(score({ title: 'Monster', results: monster.slice(0, 1), onDisk, facts: wrong })).toEqual([40])
    })

    it('fits a season numbered straight through, and absolute numbers, within the total', () => {
      const split = new Map<string, MatchFacts>([
        [
          '30981',
          show({
            seasons: [
              { number: 1, episodeCount: 25 },
              { number: 2, episodeCount: 49 },
            ],
            episodeCount: 74,
          }),
        ],
      ])
      const straight: OnDisk = { type: 'show', files: episodes(1, 60) }
      const absolute: OnDisk = { type: 'show', files: [{ season: null, episodes: [], absolute: 70 }] }
      const later: OnDisk = { type: 'show', files: episodes(2, 60) }
      const run = (disk: OnDisk) => score({ title: 'Monster', results: monster.slice(0, 1), onDisk: disk, facts: split })
      expect(run(straight)).toEqual([100])
      expect(run(absolute)).toEqual([100])
      expect(run(later)).toEqual([40])
    })

    it('leaves season 0 and unnumbered files out, and measures no fit when none is left', () => {
      const specials: OnDisk = {
        type: 'show',
        files: [...episodes(0, 99), { season: 1, episodes: [], absolute: null }],
      }
      expect(score({ title: 'Monster', results: monster.slice(0, 1), onDisk: specials, facts })).toEqual([100])
    })

    it('measures no fit for a result whose details were not read', () => {
      expect(score({ title: 'Monster', results: monster.slice(0, 1), onDisk })).toEqual([100])
    })
  })

  describe('a movie file', () => {
    const film = [result({ tmdbId: '1', title: 'Heat', year: 1995 })]
    const run = ({ minutes, runtime }: { minutes: number | null; runtime: number | null }) =>
      score({
        title: 'Heat',
        year: 1995,
        results: film,
        onDisk: { type: 'movie', duration: minutes == null ? null : minutes * 60 },
        facts: new Map([['1', movie({ runtime })]]),
      })

    it('fits within 10 minutes, half within 25, and caps it further off at 40', () => {
      expect(run({ minutes: 170, runtime: 170 })).toEqual([100])
      expect(run({ minutes: 150, runtime: 170 })).toEqual([92])
      expect(run({ minutes: 22, runtime: 170 })).toEqual([40])
    })

    it('measures no fit for an unprobed file or no runtime', () => {
      expect(run({ minutes: null, runtime: 170 })).toEqual([100])
      expect(run({ minutes: 22, runtime: null })).toEqual([100])
    })
  })

  it("caps a show from another country than the name's at 40", () => {
    const results = [
      result({ tmdbId: '2316', title: 'The Office', countries: ['US'], popularity: 90 }),
      result({ tmdbId: '2996', title: 'The Office', countries: ['GB'], popularity: 30 }),
    ]
    // The US one is held at 40, and, ruled out, is not the popularity the UK one is measured by.
    expect(score({ title: 'The Office', country: 'GB', results })).toEqual([40, 100])
  })

  it('makes no close call below 80, or when the runner-up is more than 10 behind', () => {
    const results = [
      result({ tmdbId: '1', title: 'Unknown Thing One' }),
      result({ tmdbId: '2', title: 'Unknown Thing Two' }),
    ]
    expect(score({ title: 'Unknown Thing', results })).toEqual([61, 61])
    expect(
      score({
        title: 'Heat',
        year: 1995,
        results: [result({ tmdbId: '1', title: 'Heat', year: 1995 }), result({ tmdbId: '2', title: 'Heat', year: 1986 })],
      }),
    ).toEqual([100, 60])
  })
})
```

How the expected numbers come out, so a failure can be read by hand:
- Year steps: support 1, 0.8, 0.4, 0 gives 100, 92, 76, 60; a result with no year scores the year 0, so 60.
- "Patriot Games" against "Patriot": seven of thirteen letters kept, `0.8 × (1 − 6/13)` = 0.43, and its popularity is not measured (its title is not exact): 43. "Patriot" is the only exact title, so it is the most popular among them: 100.
- "The Patriot" folds to `patriot` (`foldTitle` drops a leading "The"), so both are exact: "The Patriot" is the more popular, 100; "Patriot" is `0.6 + 0.4 × 10/90` = 64.
- Cowboy Bebop in an Anime library: the live-action series misses the tier (0 of 5), so support 0: 60; the anime fits: 100. No close call, 40 apart.
- The Office: the US one is from another country than GB, held at 40, and a result held for its country is not compared for popularity, so the UK one is the most popular left: 100.
- Heat 1995 against Heat 1986: nine years off, year 0, support 0: 60.

- [ ] **Step 7: Run the scoring tests to see them fail**

Run: `bunx nx run @raven/server:test -- src/metadata/matchConfidence.test.ts`
Expected: FAIL, `Cannot find module '@/metadata/matchConfidence'` (or `Failed to load url`).

- [ ] **Step 8: Write `scoreCandidates`**

`apps/raven/server/src/metadata/matchConfidence.ts`:

```ts
import { CONFIDENCE_STRONG, type CandidateTier, fitsTier, foldTitle, isUnfiltered } from '@raven/core'
import type { MatchFacts, SearchResult } from '@/metadata/tmdbClient'

/** A show file's numbers, as `parseEpisodeName` reads them. */
export type EpisodeNumbers = {
  season: number | null
  episodes: readonly number[]
  absolute: number | null
}

/** What the folder or file Fix match is for has on disk. */
export type OnDisk =
  | { type: 'show'; files: readonly EpisodeNumbers[] }
  | {
      type: 'movie'
      /** Seconds, or null until the file has been probed. */
      duration: number | null
    }

type ShowFacts = Extract<MatchFacts, { type: 'show' }>

/** The most a title that is not the searched one counts for. */
const PARTIAL_TITLE = 0.8
/** What an exact title is worth when nothing else agrees: Possible, never Weak. */
const SUPPORT_FLOOR = 0.6
const WEIGHTS = { year: 30, fit: 20, libraryType: 5, popularity: 5 } as const
/** Where a result that cannot be the one is held: Weak. */
const RULED_OUT = 40
/** How near the runner-up has to be to make a close call. */
const CLOSE_CALL = 10

/**
 * A title folded for comparison. `foldTitle` keeps only Latin letters and
 * digits, so a title with none (몬스터) is compared lower-cased instead;
 * otherwise every Korean title would be every other's.
 */
const comparable = (title: string): string =>
  foldTitle(title) || title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/** How many single-character edits turn `a` into `b`. */
const editDistance = ({ a, b }: { a: readonly string[]; b: readonly string[] }): number => {
  const first = Array.from({ length: b.length + 1 }, (_, index) => index)
  const last = a.reduce(
    (above, charA, row) =>
      b.reduce<number[]>(
        (current, charB, column) =>
          current.concat(
            Math.min(
              (above[column + 1] ?? 0) + 1,
              (current[column] ?? 0) + 1,
              (above[column] ?? 0) + (charA === charB ? 0 : 1),
            ),
          ),
        [row + 1],
      ),
    first,
  )
  return last[b.length] ?? 0
}

/** 1 for the same text, falling with each edit, by the longer's length. */
const similarity = ({ a, b }: { a: string; b: string }): number => {
  const charsA = [...a]
  const charsB = [...b]
  const longer = Math.max(charsA.length, charsB.length)
  return longer === 0 ? 0 : 1 - editDistance({ a: charsA, b: charsB }) / longer
}

const titleScore = ({ wanted, names }: { wanted: string; names: readonly string[] }): number => {
  const folded = names.map(comparable)
  if (folded.includes(wanted)) return 1
  return PARTIAL_TITLE * Math.max(0, ...folded.map((name) => similarity({ a: wanted, b: name })))
}

const yearScore = ({ asked, released }: { asked: number; released: number | null }): number => {
  if (released == null) return 0
  const gap = Math.abs(released - asked)
  if (gap === 0) return 1
  if (gap === 1) return 0.8
  if (gap <= 3) return 0.4
  return 0
}

/**
 * 1 when every numbered file fits the show: its season holds its episode,
 * or it is in season 1 within the show's total (numbered straight through),
 * or its absolute number is within the total. Season 0 and unnumbered files
 * are left out; null when none is left.
 */
const showFit = ({ files, facts }: { files: readonly EpisodeNumbers[]; facts: ShowFacts }): number | null => {
  const numbered = files.filter(
    (file) => file.season !== 0 && (file.episodes.length > 0 || file.absolute != null),
  )
  if (numbered.length === 0) return null
  const total = facts.episodeCount ?? 0
  const fits = (file: EpisodeNumbers): boolean => {
    const highest = Math.max(0, ...file.episodes)
    const season = facts.seasons.find((each) => each.number === file.season)
    const isInSeason = highest > 0 && season != null && highest <= season.episodeCount
    const isStraightThrough = file.season === 1 && highest > 0 && highest <= total
    const isAbsoluteWithin = file.absolute != null && file.absolute <= total
    return isInSeason || isStraightThrough || isAbsoluteWithin
  }
  return numbered.every(fits) ? 1 : 0
}

const movieFit = ({ duration, runtime }: { duration: number | null; runtime: number | null }): number | null => {
  if (duration == null || runtime == null) return null
  const gap = Math.abs(duration / 60 - runtime)
  if (gap <= 10) return 1
  if (gap <= 25) return 0.5
  return 0
}

const fitScore = ({ onDisk, facts }: { onDisk: OnDisk | null; facts: MatchFacts | undefined }): number | null => {
  if (onDisk == null || facts == null) return null
  if (onDisk.type === 'show' && facts.type === 'show') return showFit({ files: onDisk.files, facts })
  if (onDisk.type === 'movie' && facts.type === 'movie') {
    return movieFit({ duration: onDisk.duration, runtime: facts.runtime })
  }
  return null
}

/** The weighted mean of the signals measured; 1 when none is. */
const supportOf = (signals: ReadonlyArray<{ weight: number; value: number | null }>): number => {
  const measured = signals.flatMap(({ weight, value }) => (value == null ? [] : [{ weight, value }]))
  const weights = measured.reduce((sum, { weight }) => sum + weight, 0)
  if (weights === 0) return 1
  return measured.reduce((sum, { weight, value }) => sum + weight * value, 0) / weights
}

/** Two results within 10 of a Strong top, that nothing tells apart, are both held at Possible. */
const settleCloseCall = (scores: readonly number[]): number[] => {
  const top = Math.max(0, ...scores)
  const isContender = (score: number): boolean => score >= top - CLOSE_CALL
  if (top < CONFIDENCE_STRONG || scores.filter(isContender).length < 2) return [...scores]
  return scores.map((score) => (isContender(score) ? Math.min(score, CONFIDENCE_STRONG - 1) : score))
}

/**
 * How sure Fix match is of each result, from 0 to 100, in the order given:
 * the title, scaled by how well the year, what is on disk, the library's
 * type and popularity agree. See the spec's "Scoring".
 */
export const scoreCandidates = ({
  title,
  year,
  country,
  results,
  tier,
  onDisk,
  facts,
}: {
  /** The searched title. */
  title: string
  /** The searched year; null when none was asked. */
  year: number | null
  /** The country the subject's name or the searched title gives, as TMDB writes it: `GB`. */
  country: string | null
  results: readonly SearchResult[]
  /** The library type's first tier; one that filters nothing for no library. */
  tier: CandidateTier
  onDisk: OnDisk | null
  /** The details read for some results, by TMDB id. */
  facts: ReadonlyMap<string, MatchFacts>
}): number[] => {
  const wanted = comparable(title)
  const isElsewhere = (result: SearchResult): boolean =>
    country != null && result.countries.length > 0 && !result.countries.includes(country)
  const titles = results.map((result) =>
    titleScore({
      wanted,
      names: [
        result.title,
        ...(result.originalTitle == null ? [] : [result.originalTitle]),
        ...(facts.get(result.tmdbId)?.aliases ?? []),
      ],
    }),
  )
  // Popularity only tells apart results that share the title and are not ruled out by country.
  const isPopularityMeasured = (result: SearchResult, index: number): boolean =>
    titles[index] === 1 && !isElsewhere(result)
  const mostPopular = Math.max(
    0,
    ...results.flatMap((result, index) =>
      isPopularityMeasured(result, index) ? [result.popularity ?? 0] : [],
    ),
  )
  const scores = results.map((result, index) => {
    const titled = titles[index] ?? 0
    const fit = fitScore({ onDisk, facts: facts.get(result.tmdbId) })
    const support = supportOf([
      { weight: WEIGHTS.year, value: year == null ? null : yearScore({ asked: year, released: result.year }) },
      { weight: WEIGHTS.fit, value: fit },
      { weight: WEIGHTS.libraryType, value: isUnfiltered(tier) ? null : Number(fitsTier({ tier, result })) },
      {
        weight: WEIGHTS.popularity,
        value:
          isPopularityMeasured(result, index) && mostPopular > 0
            ? (result.popularity ?? 0) / mostPopular
            : null,
      },
    ])
    const score = Math.round(100 * titled * (SUPPORT_FLOOR + (1 - SUPPORT_FLOOR) * support))
    return fit === 0 || isElsewhere(result) ? Math.min(score, RULED_OUT) : score
  })
  return settleCloseCall(scores)
}
```

- [ ] **Step 9: Run the scoring tests to see them pass**

Run: `bunx nx run @raven/server:test -- src/metadata/matchConfidence.test.ts`
Expected: PASS. If a number differs, recompute it by hand from the formula before touching the code: the test numbers come from the spec's formula, and the spec is binding.

- [ ] **Step 10: Typecheck, lint, format**

Run: `bunx nx run-many -t typecheck lint:ts format -p @raven/core @raven/server`
Expected: no errors; oxfmt rewrites the long lines above into its 100-column style.

- [ ] **Step 11: Commit**

```bash
git add libs/raven/core/src/matchConfidence.ts libs/raven/core/src/matchConfidence.test.ts libs/raven/core/src/index.ts apps/raven/server/src/metadata/matchConfidence.ts apps/raven/server/src/metadata/matchConfidence.test.ts apps/raven/server/src/metadata/tmdbClient.ts
git commit -F - <<'EOF'
MAE: raven scores how sure Fix match is of each result

- `confidenceTierOf` in `@raven/core`: Strong from 80, Possible from 50
- `scoreCandidates`: the title scaled by how well the year, what is on disk, the library type and popularity agree
- a show that lacks an episode on disk, or another country's, is held at 40; a close call at 79
EOF
```

---

### Task 2: Reading a result's details, kept a day

**Files:**
- Modify: `apps/raven/server/src/metadata/tmdbClient.ts` (add `matchFacts`)
- Modify: `apps/raven/server/src/test/fakeTmdb.ts` (seasons, episode totals, runtime, popularity, appended aliases)
- Modify: `apps/raven/server/src/metadata/tmdbClient.test.ts`
- Create: `apps/raven/server/src/metadata/matchFactsCache.ts`
- Create: `apps/raven/server/src/metadata/matchFactsCache.test.ts`
- Modify: `apps/raven/server/src/appModule.ts` (provide `MatchFactsCache`, after `TmdbClient`)

**Interfaces:**
- Consumes: `MatchFacts` from Task 1.
- Produces: `TmdbClient.matchFacts({ type: MatchItemType; tmdbId: string }): Promise<MatchFacts>`; `MatchFactsCache.read({ type: MatchItemType; tmdbIds: readonly string[] }): Promise<Map<string, MatchFacts>>`, which leaves out an id whose details fail; fake TMDB fields `FakeShow.popularity`, `FakeMovie.popularity`, `FakeMovie.runtime`.

- [ ] **Step 1: Teach the fake TMDB what the details call answers**

In `apps/raven/server/src/test/fakeTmdb.ts`:

1. `FakeMovie` gains:

```ts
  /** TMDB's `runtime` in minutes: 120 when not given. */
  runtime?: number
  /** TMDB's `popularity` in a search; left out when not given. */
  popularity?: number
```

2. In `movieBody`, the line `runtime: 120,` becomes `runtime: movie.runtime ?? 120,`.

3. `FakeShow` gains:

```ts
  /** TMDB's `popularity` in a search; left out when not given. */
  popularity?: number
```

4. In `showBody`, add after `episode_run_time: [45],`:

```ts
  number_of_episodes: Object.values(show.seasons).reduce((sum, episodes) => sum + episodes.length, 0),
  seasons: Object.entries(show.seasons).map(([number, episodes]) => ({
    season_number: Number(number),
    episode_count: episodes.length,
  })),
```

Season 0 counts toward `number_of_episodes` here; TMDB leaves specials out of it, so subtract them: write the reduce over `Object.entries(show.seasons).filter(([number]) => number !== '0')` instead.

5. In the `/search/movie` mapping, add `...(movie.popularity == null ? {} : { popularity: movie.popularity }),`; in the `/search/tv` mapping, add `...(show.popularity == null ? {} : { popularity: show.popularity }),`.

6. In the `/tv/{id}` and `/movie/{id}` handlers, append the aliases when asked, as TMDB does with `append_to_response=alternative_titles`:

```ts
    const appended = (query.get('append_to_response') ?? '').split(',')
```

declared once after `const query = parsed.searchParams`, then:

```ts
      return found
        ? json({
            ...showBody(found),
            ...(appended.includes('alternative_titles')
              ? { alternative_titles: { results: (found.alternativeTitles ?? []).map((title) => ({ iso_3166_1: 'GB', title, type: '' })) } }
              : {}),
          })
        : json({ status_code: 34 }, 404)
```

and for a movie the same with `movieBody(found)` and `alternative_titles: { titles: [...] }` (`iso_3166_1: 'US'`), as the `/alternative_titles` handler below already writes them.

- [ ] **Step 2: Write the failing client tests**

Add to the `describe('TmdbClient', ...)` in `apps/raven/server/src/metadata/tmdbClient.test.ts`:

```ts
  it("reads a show's seasons, episode total and aliases for Fix match, in one call", async () => {
    const tmdb = fakeTmdb({
      movies: [],
      shows: [
        {
          id: 30981,
          title: 'Monster',
          first: '2004-04-07',
          alternativeTitles: ['MONSTER'],
          seasons: {
            0: [{ number: 1, title: 'Special', aired: '2004-01-01' }],
            1: [
              { number: 1, title: 'Herr Dr. Tenma', aired: '2004-04-07' },
              { number: 2, title: 'Downfall', aired: '2004-04-14' },
            ],
          },
        },
      ],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    expect(await client.matchFacts({ type: 'show', tmdbId: '30981' })).toEqual({
      type: 'show',
      aliases: ['MONSTER'],
      seasons: [
        { number: 0, episodeCount: 1 },
        { number: 1, episodeCount: 2 },
      ],
      episodeCount: 2,
    })
    expect(tmdb.state.calls).toHaveLength(1)
    expect(new URL(tmdb.state.calls[0] ?? '').searchParams.get('append_to_response')).toBe(
      'alternative_titles',
    )
  })

  it("reads a movie's runtime and aliases for Fix match", async () => {
    const tmdb = fakeTmdb({
      movies: [
        { id: 949, title: 'Heat', released: '1995-12-15', runtime: 170, alternativeTitles: ['Fuego contra fuego'] },
      ],
    })
    const client = new TmdbClient(config(), tmdb.fetch)
    expect(await client.matchFacts({ type: 'movie', tmdbId: '949' })).toEqual({
      type: 'movie',
      aliases: ['Fuego contra fuego'],
      runtime: 170,
    })
  })
```

- [ ] **Step 3: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/metadata/tmdbClient.test.ts`
Expected: FAIL, `client.matchFacts is not a function`.

- [ ] **Step 4: Write `matchFacts`**

In `TmdbClient`, after `alternativeTitles`:

```ts
  /**
   * What Fix match's confidence reads of a result beyond its search: a
   * show's seasons and episode total, or a movie's runtime, and its other
   * titles, in one call.
   */
  async matchFacts({ type, tmdbId }: { type: MatchItemType; tmdbId: string }): Promise<MatchFacts> {
    const body = record(
      await this.get(`/${type === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(tmdbId)}`, {
        append_to_response: 'alternative_titles',
      }),
    )
    const titled = record(body.alternative_titles)
    // A movie's come as `titles`, a show's as `results`.
    const aliases = records(titled.titles ?? titled.results).flatMap((entry) => text(entry.title) ?? [])
    if (type === 'movie') return { type, aliases, runtime: number(body.runtime) || null }
    return {
      type,
      aliases,
      seasons: records(body.seasons).flatMap((season) => {
        const seasonNumber = number(season.season_number)
        const episodeCount = number(season.episode_count)
        return seasonNumber == null || episodeCount == null ? [] : [{ number: seasonNumber, episodeCount }]
      }),
      episodeCount: number(body.number_of_episodes),
    }
  }
```

- [ ] **Step 5: Run the client tests to see them pass**

Run: `bunx nx run @raven/server:test -- src/metadata/tmdbClient.test.ts`
Expected: PASS, the two new tests and every older one.

- [ ] **Step 6: Write the failing cache test**

`apps/raven/server/src/metadata/matchFactsCache.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { MatchFactsCache } from '@/metadata/matchFactsCache'
import { TmdbClient } from '@/metadata/tmdbClient'
import { fakeTmdb } from '@/test/fakeTmdb'

const detailsCalls = (calls: readonly string[]): number =>
  calls.filter((url) => /^\/3\/movie\/\d+$/.test(new URL(url).pathname)).length

describe('MatchFactsCache', () => {
  const setUp = () => {
    const tmdb = fakeTmdb({
      movies: [
        { id: 949, title: 'Heat', released: '1995-12-15', runtime: 170 },
        { id: 8195, title: 'Ronin', released: '1998-09-25', runtime: 122 },
      ],
    })
    const client = new TmdbClient({ ...readServerConfig({}), tmdbApiToken: 'secret-token' }, tmdb.fetch)
    return { tmdb, cache: new MatchFactsCache(client) }
  }

  it('reads each result once, and from memory after', async () => {
    const { tmdb, cache } = setUp()
    const first = await cache.read({ type: 'movie', tmdbIds: ['949', '8195'] })
    expect([...first.keys()]).toEqual(['949', '8195'])
    expect(first.get('949')).toMatchObject({ type: 'movie', runtime: 170 })
    await cache.read({ type: 'movie', tmdbIds: ['949', '8195'] })
    expect(detailsCalls(tmdb.state.calls)).toBe(2)
  })

  it('leaves out a result whose details fail, and asks again next time', async () => {
    const { tmdb, cache } = setUp()
    tmdb.state.failing.push('/movie/949')
    const read = await cache.read({ type: 'movie', tmdbIds: ['949', '8195'] })
    expect([...read.keys()]).toEqual(['8195'])
    tmdb.state.failing.splice(0)
    expect([...(await cache.read({ type: 'movie', tmdbIds: ['949'] })).keys()]).toEqual(['949'])
  })

  it('keeps a movie and a show with the same id apart', async () => {
    const { cache } = setUp()
    const read = await cache.read({ type: 'show', tmdbIds: ['949'] })
    expect(read.size).toBe(0)
  })
})
```

`fakeTmdb` answers a 404 for `/tv/949`, which `TmdbClient.get` throws as `TmdbError`; the cache leaves it out.

- [ ] **Step 7: Run it to see it fail**

Run: `bunx nx run @raven/server:test -- src/metadata/matchFactsCache.test.ts`
Expected: FAIL, `Cannot find module '@/metadata/matchFactsCache'`.

- [ ] **Step 8: Write the cache**

`apps/raven/server/src/metadata/matchFactsCache.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common'
import type { MatchItemType } from '@raven/core'
import { type MatchFacts, TmdbClient } from '@/metadata/tmdbClient'

const DAY_MS = 24 * 60 * 60 * 1000
const MOST_KEPT = 500

/**
 * The details Fix match's confidence reads, kept in memory a day so a
 * search asked again costs TMDB nothing. The oldest goes past 500.
 */
@Injectable()
export class MatchFactsCache {
  private readonly kept = new Map<string, { facts: MatchFacts; at: number }>()

  constructor(@Inject(TmdbClient) private readonly tmdb: TmdbClient) {}

  /** Each result's details, by TMDB id, read together; one TMDB cannot give is left out. */
  async read({
    type,
    tmdbIds,
  }: {
    type: MatchItemType
    tmdbIds: readonly string[]
  }): Promise<Map<string, MatchFacts>> {
    const read = await Promise.all(
      tmdbIds.map(async (tmdbId) => {
        const facts = await this.one({ type, tmdbId }).catch(() => null)
        return facts == null ? [] : [[tmdbId, facts] as const]
      }),
    )
    return new Map(read.flat())
  }

  private async one({ type, tmdbId }: { type: MatchItemType; tmdbId: string }): Promise<MatchFacts> {
    const key = `${type}:${tmdbId}`
    const kept = this.kept.get(key)
    if (kept != null && Date.now() - kept.at < DAY_MS) return kept.facts
    const facts = await this.tmdb.matchFacts({ type, tmdbId })
    this.kept.delete(key)
    this.kept.set(key, { facts, at: Date.now() })
    const [oldest] = this.kept.keys()
    if (this.kept.size > MOST_KEPT && oldest != null) this.kept.delete(oldest)
    return facts
  }
}
```

Register it: in `apps/raven/server/src/appModule.ts`, import `MatchFactsCache` from `@/metadata/matchFactsCache` and add it to `providers` after `TmdbClient`.

- [ ] **Step 9: Run the cache tests to see them pass**

Run: `bunx nx run @raven/server:test -- src/metadata/matchFactsCache.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 10: Run the whole server suite**

Run: `bunx nx run @raven/server:test`
Expected: PASS. The fake's new fields (`seasons`, `number_of_episodes`, popularity only when given) change no older answer; if a test that counts `calls` moves, it is reading `/tv/{id}` bodies, and the added fields never add a call.

- [ ] **Step 11: Typecheck, lint, format, commit**

Run: `bunx nx run-many -t typecheck lint:ts format -p @raven/server`

```bash
git add apps/raven/server/src/metadata/tmdbClient.ts apps/raven/server/src/metadata/tmdbClient.test.ts apps/raven/server/src/test/fakeTmdb.ts apps/raven/server/src/metadata/matchFactsCache.ts apps/raven/server/src/metadata/matchFactsCache.test.ts apps/raven/server/src/appModule.ts
git commit -F - <<'EOF'
MAE: raven reads a result's seasons, runtime and aliases for Fix match

- `TmdbClient.matchFacts`: `/tv/{id}` or `/movie/{id}` with `alternative_titles`, in one call
- `MatchFactsCache` keeps them a day, at most 500, and leaves out one TMDB cannot give
- the fake TMDB answers seasons, episode totals, runtimes and popularity
EOF
```

---

### Task 3: The search answers a confidence, best first

**Files:**
- Modify: `libs/raven/core/src/contract.ts` (`isMatchCandidate.confidence`, `isMatchSubject`)
- Modify: `libs/raven/core/src/contract.test.ts`
- Modify: `libs/raven/core/src/naming.ts` (export `countryOf`)
- Modify: `libs/raven/core/src/apiClient.ts` (`searchMatches` takes `subject`)
- Modify: `libs/raven/core/src/apiClient.test.ts`
- Modify: `apps/raven/server/src/items/matchController.ts`
- Create: `apps/raven/server/src/items/matchSearch.test.ts`
- Modify: the web tests whose search spies answer candidates, so each candidate carries a `confidence`: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.test.tsx`, `apps/raven/web/src/components/UnmatchedShows/UnmatchedShows.test.tsx`, `apps/raven/web/src/components/SuggestedMovies/SuggestedMovies.test.tsx`, `apps/raven/web/src/pages/ShowPage/ShowPage.test.tsx`, and any other the web typecheck names

**Interfaces:**
- Consumes: `scoreCandidates`, `OnDisk`, `EpisodeNumbers` (Task 1); `MatchFactsCache.read` (Task 2); `MatchFiles.underFolder`, `MatchFiles.under`, `MediaRepository.get`, `MediaRepository.forItem`, `LockService.viewer({ cookie }).seesLibrary(id)`, `showFolderOf` and `parseEpisodeName` from `@raven/core`.
- Produces: `MatchCandidate.confidence: number`; `isMatchSubject`, `MatchSubject = { kind: 'media'; id: number } | { kind: 'item'; id: number }`; `api.searchMatches({ type, query, year?, libraryId?, subject? })` sending `mediaId=` or `itemId=`; `GET /api/match/search?...&mediaId=` or `&itemId=`.

- [ ] **Step 1: Write the failing core tests**

In `libs/raven/core/src/contract.test.ts`, in `it('accepts match candidates and the metadata health', ...)`, add `confidence: 94,` to the candidate and add after it:

```ts
    expect(
      isMatchCandidate({ tmdbId: '603', title: 'The Matrix', year: 1999, overview: null, poster: null }),
    ).toBe(false)
    expect(isMatchSubject({ kind: 'media', id: 7 })).toBe(true)
    expect(isMatchSubject({ kind: 'item', id: 7 })).toBe(true)
    expect(isMatchSubject({ kind: 'folder', id: 7 })).toBe(false)
```

and import `isMatchSubject` at the top with the other guards.

In `libs/raven/core/src/apiClient.test.ts`, after the test that names the library:

```ts
  it('names the file or show a search is for, so it can be scored against what is on disk', async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await client.searchMatches({ type: 'show', query: 'Monster', subject: { kind: 'media', id: 12 } })
    await client.searchMatches({ type: 'show', query: 'Monster', subject: { kind: 'item', id: 40 } })
    expect(calls.map((call) => call.url)).toEqual([
      'http://nas:8484/api/match/search?type=show&query=Monster&mediaId=12',
      'http://nas:8484/api/match/search?type=show&query=Monster&itemId=40',
    ])
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/core:test`
Expected: FAIL: `isMatchSubject` is not exported, the candidate without `confidence` is accepted, and the subject is not sent.

- [ ] **Step 3: Write the contract, the client and the export**

In `libs/raven/core/src/contract.ts`, `isMatchCandidate` gains, after `poster`:

```ts
  /** How sure Fix match is that this is the folder's or file's movie or show: a whole number from 0 to 100. */
  confidence: isNumber,
```

and after `isMatchCandidateList`:

```ts
/** What a Fix match search is for: a file (and the show folder it is in), or a matched show. */
export const isMatchSubject = union(
  object({ kind: oneOf(['media']), id: isNumber }),
  object({ kind: oneOf(['item']), id: isNumber }),
)

export type MatchSubject = Infer<typeof isMatchSubject>
```

In `libs/raven/core/src/naming.ts`, `const countryOf` becomes `export const countryOf`.

In `libs/raven/core/src/apiClient.ts`, import `type MatchSubject` from `@/contract`, add above the client factory:

```ts
/** The query a search's subject adds: the file, or the show, it is scored against. */
const subjectQuery = (subject: MatchSubject | null): Record<string, string> => {
  if (subject == null) return {}
  switch (subject.kind) {
    case 'media':
      return { mediaId: String(subject.id) }
    case 'item':
      return { itemId: String(subject.id) }
    default: {
      const unreachable: never = subject
      return unreachable
    }
  }
}
```

and `searchMatches` becomes:

```ts
    searchMatches: ({
      type,
      query,
      year,
      libraryId,
      subject = null,
    }: {
      type: MatchItemType
      query: string
      year?: number | null
      libraryId?: number | null
      /** The file or show the search is for, which its results are scored against. */
      subject?: MatchSubject | null
    }): Promise<MatchCandidate[]> =>
      expect({
        request: send({
          path: `/api/match/search?${toQueryString({
            type,
            query: query.trim(),
            ...(year == null ? {} : { year: String(year) }),
            ...(libraryId == null ? {} : { libraryId: String(libraryId) }),
            ...subjectQuery(subject),
          })}`,
        }),
        guard: isMatchCandidateList,
      }),
```

If `countryOf` clashes with another export of `@raven/core` (the typecheck says so), name it `countryOfName` instead and use that name below.

- [ ] **Step 4: Run the core tests to see them pass**

Run: `bunx nx run @raven/core:test`
Expected: PASS.

- [ ] **Step 5: Write the failing endpoint tests**

`apps/raven/server/src/items/matchSearch.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type MatchCandidate,
  isLibrary,
  isMatchCandidateList,
  isMediaList,
  isShowListing,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { ADMIN_PASSWORD, adminCookie, cookieSet, cookies } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { type FakeEpisode, fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = { statusCode: number; rawPayload: Buffer; json: () => unknown }

const shape = <T>({ response, guard }: { response: Injected; guard: (value: unknown) => value is T }): T => {
  const body: unknown = response.json()
  if (!guard(body)) throw new Error(`Unexpected body: ${response.rawPayload.toString()}`)
  return body
}

const run = (count: number): FakeEpisode[] =>
  Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    title: `Episode ${index + 1}`,
    aired: '2004-04-07',
  }))

const isDetailsCall = (url: string): boolean => /^\/3\/(tv|movie)\/\d+$/.test(new URL(url).pathname)

describe('Fix match confidence', () => {
  const tmdb = fakeTmdb({
    movies: [
      { id: 501, title: 'Short Film', released: '2020-03-01', runtime: 1 },
      { id: 502, title: 'Short Film', released: '2021-05-01', runtime: 120 },
    ],
    shows: [
      { id: 30981, title: 'Monster', first: '2004-04-07', popularity: 50, seasons: { 1: run(74) } },
      { id: 65806, title: 'Monster', first: '2016-03-12', popularity: 10, seasons: { 1: run(50) } },
      { id: 131532, title: 'Monster High', first: '2022-10-06', popularity: 80, seasons: { 1: run(13) } },
      { id: 69084, title: 'Monster Strike', first: '2015-10-10', seasons: { 1: run(12) } },
      { id: 15130, title: 'Monster Rancher', first: '1999-04-05', seasons: { 1: run(48) } },
      { id: 51808, title: 'Robot and Monster', first: '2012-08-04', seasons: { 1: run(26) } },
      { id: 64198, title: 'Blaze and the Monster Machines', first: '2014-10-13', seasons: { 1: run(20) } },
      { id: 7101, title: 'Patriot', first: '2015-11-05', seasons: { 1: run(10) } },
    ],
  })
  const state: {
    root: string
    app: NestFastifyApplication | null
    tv: number
    films: number
    vault: number
  } = { root: '', app: null, tv: 0, films: 0, vault: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const search = async ({ query, cookie }: { query: string; cookie?: string }): Promise<MatchCandidate[]> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/match/search?${query}`,
        ...(cookie == null ? {} : { headers: { cookie } }),
      }),
      guard: isMatchCandidateList,
    })
  const scores = (candidates: readonly MatchCandidate[]) =>
    candidates.map((candidate) => [candidate.tmdbId, candidate.confidence])
  const mediaOf = async ({ library, cookie }: { library: number; cookie?: string }) =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${library}/media`,
        ...(cookie == null ? {} : { headers: { cookie } }),
      }),
      guard: isMediaList,
    })
  const fileNamed = async ({ library, name, cookie }: { library: number; name: string; cookie?: string }) => {
    const found = (await mediaOf({ library, cookie })).find((file) => file.fileName === name)
    if (!found) throw new Error(`No file ${name}`)
    return found
  }

  const NO_SUBJECT = [
    ['30981', 100],
    ['65806', 68],
    ['131532', 47],
    ['69084', 40],
    ['15130', 37],
    ['51808', 33],
    ['64198', 19],
  ]
  const ON_DISK = [
    ['30981', 79],
    ['65806', 79],
    ['15130', 37],
    ['51808', 33],
    ['131532', 28],
    ['69084', 24],
    ['64198', 19],
  ]

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-confidence-'))
    const tv = join(state.root, 'TV')
    const films = join(state.root, 'Films')
    const vault = join(state.root, 'Vault')
    await Promise.all([
      encodeClip({ path: join(tv, 'Monster', 'Season 1', 'Monster - S01E01.mp4'), seconds: 1 }),
      encodeClip({ path: join(tv, 'Monster', 'Season 1', 'Monster - S01E35.mp4'), seconds: 1 }),
      encodeClip({ path: join(films, 'Short Film (2020)', 'Short Film (2020).mp4'), seconds: 1 }),
      encodeClip({ path: join(vault, 'Monster', 'Season 1', 'Monster - S01E35.mp4'), seconds: 1 }),
    ])
    state.app = await createApp({
      config: {
        ...readServerConfig({}),
        hwAccel: 'none',
        dataDir: join(state.root, 'data'),
        webDir: null,
        browseRoot: state.root,
        scanOnStart: false,
        rescanIntervalMinutes: 0,
        tmdbApiToken: 'test-token',
        libraryPin: '3001',
        adminPassword: ADMIN_PASSWORD,
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    const admin = await adminCookie(app())
    const create = async (payload: Record<string, unknown>) =>
      shape({
        response: await app().inject({ method: 'POST', url: '/api/libraries', headers: { cookie: admin }, payload }),
        guard: isLibrary,
      }).id
    state.tv = await create({ name: 'TV', paths: [tv], settings: { kind: 'shows' } })
    state.films = await create({ name: 'Films', paths: [films], settings: { kind: 'movies' } })
    state.vault = await create({ name: 'Vault', paths: [vault], settings: { kind: 'shows', locked: true } })
    await Promise.all([state.tv, state.films, state.vault].map((id) => app().get(ScannerService).whenIdle(id)))
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('reads the details of the top five only, and none when asked again', async () => {
    const before = tmdb.state.calls.length
    expect(scores(await search({ query: 'type=show&query=Monster' }))).toEqual(NO_SUBJECT)
    const asked = tmdb.state.calls.slice(before).filter(isDetailsCall)
    expect(asked.map((url) => new URL(url).pathname).toSorted()).toEqual(
      ['/3/tv/131532', '/3/tv/15130', '/3/tv/30981', '/3/tv/65806', '/3/tv/69084'].toSorted(),
    )
    const again = tmdb.state.calls.length
    await search({ query: 'type=show&query=Monster' })
    expect(tmdb.state.calls.slice(again).filter(isDetailsCall)).toEqual([])
  })

  it('scores a show folder against its episodes on disk, by a file or by the show', async () => {
    const file = await fileNamed({ library: state.tv, name: 'Monster - S01E35.mp4' })
    expect(scores(await search({ query: `type=show&query=Monster&mediaId=${file.id}` }))).toEqual(ON_DISK)
    const listing = shape({
      response: await app().inject({ method: 'GET', url: `/api/libraries/${state.tv}/shows` }),
      guard: isShowListing,
    })
    const showId = listing.shows[0]?.show.id
    expect(showId).toBeDefined()
    expect(scores(await search({ query: `type=show&query=Monster&itemId=${showId}` }))).toEqual(ON_DISK)
  })

  it("scores a movie against its file's duration, best first", async () => {
    const film = await fileNamed({ library: state.films, name: 'Short Film (2020).mp4' })
    expect(film.duration).not.toBeNull()
    expect(scores(await search({ query: 'type=movie&query=Short%20Film&year=2020' }))).toEqual([
      ['501', 79],
      ['502', 79],
    ])
    expect(
      scores(await search({ query: `type=movie&query=Short%20Film&year=2020&mediaId=${film.id}` })),
    ).toEqual([
      ['501', 100],
      ['502', 40],
    ])
  })

  it('scores a subject in a library this browser may not see as if there were none', async () => {
    const admin = await adminCookie(app())
    const pin = cookieSet(
      await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: { pin: '3001' } }),
    )
    const unlocked = cookies(admin, pin)
    const hidden = await fileNamed({ library: state.vault, name: 'Monster - S01E35.mp4', cookie: unlocked })
    const query = `type=show&query=Monster&mediaId=${hidden.id}`
    expect(scores(await search({ query }))).toEqual(NO_SUBJECT)
    expect(scores(await search({ query, cookie: unlocked }))).toEqual(ON_DISK)
  })

  it('answers when a details call fails, scoring that result without it', async () => {
    tmdb.state.failing.push('/tv/7101')
    expect(scores(await search({ query: 'type=show&query=Patriot' }))).toEqual([['7101', 100]])
    tmdb.state.failing.splice(0)
  })

  it('treats a file raven no longer has as no subject', async () => {
    expect(scores(await search({ query: 'type=show&query=Monster&mediaId=999999' }))).toEqual(NO_SUBJECT)
  })

  it('refuses both a file and a show, or an id that is not one', async () => {
    const statusOf = async (query: string) =>
      (await app().inject({ method: 'GET', url: `/api/match/search?type=show&query=Monster&${query}` }))
        .statusCode
    expect(await statusOf('mediaId=1&itemId=2')).toBe(400)
    expect(await statusOf('mediaId=abc')).toBe(400)
    expect(await statusOf('itemId=1.5')).toBe(400)
  })
})
```

How the expected numbers come out, so a failure can be read:
- `NO_SUBJECT`: "Monster" (2004) is the more popular of the two exact titles: 100; (2016): `0.6 + 0.4 × 10/50` = 68. The others have no exact title, so popularity is not measured and nothing else is: support 1, the score is the partial title: 47, 40, 37, 33, 19 (see `scores.py` in the spec's working). Monster High's popularity (80) is never compared, as its title is not the searched one.
- `ON_DISK`: the five read have a fit; 2004 and 2016 fit (S01E35 within 74 and 50): 100 and 94, a close call, both 79. Rancher (48) fits, and with nothing else measured stays 37. Monster High (13) and Monster Strike (12) do not: support 0, `0.6 × title`, 28 and 24, under the 40 cap, so they fall below Robot and Monster (33), which was not read and is unchanged, as is Blaze (19).
- The vault's file is in a locked library: without the PIN the subject is ignored.
- Short Film: with no subject, 2020 is 100 and 2021 is 92 (year 0.8), a close call: 79 and 79, today's order. With the file (1 second): 2020 fits (1 minute), 100; 2021 is 120 minutes off, held at 40.

- [ ] **Step 6: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/items/matchSearch.test.ts`
Expected: FAIL: the answers carry no `confidence`, so `isMatchCandidateList` rejects them (`Unexpected body`), and the typecheck of the controller fails on the missing field.

- [ ] **Step 7: Wire the controller**

In `apps/raven/server/src/items/matchController.ts`:

1. Imports: add `countryOf`, `type MatchSubject`, `parseEpisodeName`, `showFolderOf` from `@raven/core`; `MatchFiles` from `@/metadata/matchFiles`; `MatchFactsCache` from `@/metadata/matchFactsCache`; `type OnDisk, scoreCandidates` from `@/metadata/matchConfidence`.

2. Constructor gains:

```ts
    @Inject(MatchFiles) private readonly files: MatchFiles,
    @Inject(MatchFactsCache) private readonly facts: MatchFactsCache,
```

3. Module constants, after `tmdbFailure`:

```ts
/** How many of the first-scored results Fix match reads the details of. */
const DETAILS_FOR = 5

const WHOLE_NUMBER = /^\d+$/

/** What a search scores against when it is for nothing on disk, or for something this browser may not see. */
const NOTHING_ON_DISK = { onDisk: null, country: null } as const satisfies {
  onDisk: OnDisk | null
  country: string | null
}
```

4. `search` takes two more query parameters and scores:

```ts
  @Get('match/search')
  async search(
    @Query('type') type: string | undefined,
    @Query('query') query: string | undefined,
    @Query('year') year: string | undefined,
    @Query('libraryId') libraryId: string | undefined,
    @Query('mediaId') mediaId: string | undefined,
    @Query('itemId') itemId: string | undefined,
    @Headers('cookie') cookie: string | undefined,
  ): Promise<MatchCandidate[]> {
    if (!isMatchItemType(type)) throw new BadRequestException('type must be movie or show')
    if (!query?.trim()) throw new BadRequestException('Search for a title.')
    const preferred = this.preferredBy({ libraryId, cookie })
    const subject = subjectFrom({ mediaId, itemId })
    this.requireTmdb()
    const parsedYear = Number.parseInt(year ?? '', 10)
    const asked = { query: query.trim(), year: Number.isInteger(parsedYear) ? parsedYear : null }
    const results = await (
      type === 'movie' ? this.tmdb.searchMovies(asked) : this.tmdb.searchShows(asked)
    ).catch(tmdbFailure)
    const rank = (result: SearchResult): number => (fitsTier({ tier: preferred, result }) ? 0 : 1)
    const ordered = results.toSorted((a, b) => rank(a) - rank(b))
    const { onDisk, country } = this.onDiskOf({ type, subject, cookie })
    const scoring = {
      title: asked.query,
      year: asked.year,
      country: country ?? countryOf(asked.query),
      results: ordered,
      tier: preferred,
      onDisk,
    }
    const first = scoreCandidates({ ...scoring, facts: new Map() })
    const top = ordered
      .map((result, index) => ({ tmdbId: result.tmdbId, confidence: first[index] ?? 0 }))
      .toSorted((a, b) => b.confidence - a.confidence)
      .slice(0, DETAILS_FOR)
      .map((each) => each.tmdbId)
    const confidences = scoreCandidates({
      ...scoring,
      facts: await this.facts.read({ type, tmdbIds: top }),
    })
    return ordered
      .map(({ tmdbId, title, year: released, overview, poster }, index) => ({
        tmdbId,
        title,
        year: released,
        overview,
        poster,
        confidence: confidences[index] ?? 0,
      }))
      .toSorted((a, b) => b.confidence - a.confidence)
  }
```

Update the method's doc comment: "TMDB's results for Fix match, each with how sure raven is of it, best first. With `libraryId`, those that fit the library type's first tier come first among equals; with `mediaId` or `itemId`, they are scored against what that file's show folder, that movie file or that show has on disk."

5. A module-level function, above the class:

```ts
/** The file or show a search names, or null for none; a malformed id, or both, is a 400. */
const subjectFrom = ({
  mediaId,
  itemId,
}: {
  mediaId: string | undefined
  itemId: string | undefined
}): MatchSubject | null => {
  if (mediaId != null && itemId != null) {
    throw new BadRequestException('Name a file or a show, not both.')
  }
  if (mediaId != null) {
    if (!WHOLE_NUMBER.test(mediaId)) throw new BadRequestException('mediaId must be a media id')
    return { kind: 'media', id: Number(mediaId) }
  }
  if (itemId != null) {
    if (!WHOLE_NUMBER.test(itemId)) throw new BadRequestException('itemId must be an item id')
    return { kind: 'item', id: Number(itemId) }
  }
  return null
}
```

6. Two private methods in the class, after `preferredBy`:

```ts
  /**
   * What a search's subject has on disk, and the country its name gives;
   * nothing for no subject, one raven no longer has, or one in a library
   * the lock keeps from this browser, so the scores never tell it is there.
   */
  private onDiskOf({
    type,
    subject,
    cookie,
  }: {
    type: MatchItemType
    subject: MatchSubject | null
    cookie: string | undefined
  }): { onDisk: OnDisk | null; country: string | null } {
    if (subject == null) return NOTHING_ON_DISK
    const viewer = this.lock.viewer({ cookie })
    const files = this.subjectFiles({ type, subject }).filter((file) => viewer.seesLibrary(file.libraryId))
    const [first] = files
    if (first == null) return NOTHING_ON_DISK
    switch (type) {
      case 'movie':
        return { onDisk: { type: 'movie', duration: first.duration }, country: null }
      case 'show': {
        const named = files.map((file) => parseEpisodeName({ fileName: file.fileName, folder: file.folder }))
        return {
          onDisk: {
            type: 'show',
            files: named.map(({ season, episodes, absolute }) => ({ season, episodes, absolute })),
          },
          country: named.find((name) => name.country != null)?.country ?? null,
        }
      }
      default: {
        const unreachable: never = type
        return unreachable
      }
    }
  }

  /**
   * The files a subject stands for: a show file's whole show folder, a movie
   * file alone, a matched show's every file, or a movie item's best file.
   */
  private subjectFiles({
    type,
    subject,
  }: {
    type: MatchItemType
    subject: MatchSubject
  }): Array<{ libraryId: number; fileName: string; folder: string; duration: number | null }> {
    switch (subject.kind) {
      case 'media': {
        const file = this.media.get(subject.id)
        if (file == null) return []
        const showFolder = type === 'show' ? showFolderOf(file) : null
        if (showFolder == null) return [file]
        return this.files
          .underFolder({ libraryId: file.libraryId, folder: showFolder })
          .map((each) => ({ ...each, duration: null }))
      }
      case 'item':
        return type === 'show'
          ? this.files.under(subject.id).map((each) => ({ ...each, duration: null }))
          : this.media.forItem(subject.id).slice(0, 1)
      default: {
        const unreachable: never = subject
        return unreachable
      }
    }
  }
```

`MatchFile` has no `duration`; a show's files never need one, so they carry `null`. `MediaItem` has `libraryId`, `fileName`, `folder` and `duration`, so a movie file is returned as it is.

- [ ] **Step 8: Run the endpoint tests to see them pass**

Run: `bunx nx run @raven/server:test -- src/items/matchSearch.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 9: Give the web's test candidates a confidence**

Run: `bunx nx run @raven/web:typecheck`
Expected: FAIL, naming each candidate literal in a web test that lacks `confidence`.

Add a `confidence` to each, keeping today's look and order: the first candidate of each list `confidence: 90`, later ones descending by 10 (`80`, `70`, ...). The dialog does not show it yet (step 2 of the stack does), so no assertion changes.

Run: `bunx nx run @raven/web:typecheck` and `bunx nx run @raven/web:test`
Expected: PASS.

- [ ] **Step 10: Run every raven suite and the checks**

Run: `bunx nx run-many -t test typecheck lint:ts -p @raven/core @raven/server @raven/web`
Expected: PASS. `libraryTypes.test.ts`'s order test passes unchanged: its two "Cowboy Bebop" results tie at 79 (a close call) when the library does not filter, so today's order stands, and in an Anime library the anime scores 100 to the series' 60.

- [ ] **Step 11: Format and commit**

Run: `bunx nx run-many -t format -p @raven/core @raven/server @raven/web`

```bash
git add libs/raven/core/src apps/raven/server/src/items apps/raven/web/src
git commit -F - <<'EOF'
MAE: raven's Fix match search answers how sure it is, best first

- `MatchCandidate.confidence`, from 0 to 100; `MatchSubject` names the file or show a search is for
- the search scores against that folder's episodes or that file's duration, read only where the lock lets this browser see
- the top five results' details are read once and kept; a failed read scores without them
EOF
```

---

## After the tasks

- Commit the spec and both plans first on the branch (`docs/superpowers/specs/2026-10-13-raven-match-confidence-design.md`, `docs/superpowers/plans/2026-10-13-raven-match-confidence-server.md`, `docs/superpowers/plans/2026-10-13-raven-match-confidence-web.md`), as `MAE: raven match confidence design and plans`.
- `bun run verify` from the repo root, then push and open the PR with the `pr-format` skill: title `MAE: raven scores how sure Fix match is of each result`, base `main`.
