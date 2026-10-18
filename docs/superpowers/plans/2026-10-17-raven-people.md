# raven people, back buttons, show ratings and library Refresh: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task.

**Goal:**
- A person page with TMDB details and the person's whole filmography as a searchable, tabbed table that marks what plays on raven.
- A Back button on every page that steps back through the app.
- Rotten Tomatoes and Metacritic for TV shows through MDBList.
- An admin Refresh per library that looks for new files and re-fetches every title's ratings.
- Folders on a library card grouped by parent.

**Spec:** `docs/superpowers/specs/2026-10-17-raven-people-design.md`. It is the authority; this plan argues from it.

## Global Constraints

- **Repo rules.** Everything in the root `CLAUDE.md` and `apps/raven/CLAUDE.md`:
  - no `any`, no casts (`as const` is fine), no `!` outside tests, no `interface`, no enums, no `for` loops;
  - one object parameter, `??` not `||`, no floating promises;
  - guards at every boundary, `@/` imports with no extension;
  - no em or en dashes anywhere (code, comments, copy, docs);
  - comments only for a non-obvious why, matching the surrounding comment density and voice.
- **Contract.** Each new API shape is an `is<Type>` guard in `libs/raven/core/src/contract.ts` built from `schema.ts`'s combinators, and its type is `Infer<typeof isX>`. A union of literals is a `oneOf([...])`.
- **`libs/raven/core` stays platform-agnostic:** no DOM, no Node, no `URLSearchParams`.
- **Server.**
  - Every non-GET route is `@AdminOnly()` or `@ForViewers()`.
  - Constructors inject with explicit `@Inject(Token)`.
  - A response that depends on the cookie is never `public` in `cache-control`.
  - A migration is appended to `MIGRATIONS` in `apps/raven/server/src/db/database.ts`; never edit an existing one.
  - A new table is added to `NOT_IN_THE_COPY` in `apps/raven/server/src/test/queryPlans.test.ts`, and a new index to `PRODUCTION_STATISTICS` in `src/test/queryPlans.ts` when that test demands it.
- **Web.**
  - SCSS modules imported through `@/`, laid out with grid and `gap` (no flex, no margins for spacing).
  - Named `grid-template-areas` in fixed layouts.
  - Tokens from `libs/raven/ui/src/styles/globals.scss` only.
  - A visible `:focus-visible` with `--focus-ring`.
  - Motion only inside `@media (prefers-reduced-motion: no-preference)`.
  - Every page works at 320px.
  - Every search box is a `SearchField` held by `useSearch` or `useAddressSearch`.
  - JSX uses `&&`, not a ternary with `null`.
- **Commits and checks.**
  - Commits follow the `commit-format` skill: a `MAE:` subject, short bullets, no attribution.
  - Before each commit, run `bunx nx affected -t typecheck lint:ts lint:css format:check test` for the touched projects, or the per-project targets (`bunx nx run @raven/web:test`, and so on).
  - lefthook runs on commit. Never `--no-verify`, never `LEFTHOOK=0`.
- **Never push and never open a PR.** The controller asks the user first.

## PR stack

| PR | Branch | Base | Tasks |
| --- | --- | --- | --- |
| 1 | `people-filmography` (this worktree) | `main` | spec and plan, 1, 2 |
| 2 | `people-folders` | PR 1 | 3 |
| 3 | `people-server` | PR 2 | 4, 5, 6 |
| 4 | `people-page` | PR 3 | 7 |
| 5 | `people-mdblist` | PR 4 | 8, 9, 10 |
| 6 | `people-refresh` | PR 5 | 11 |
| 7 | `people-refresh-web` | PR 6 | 12 |

---

## PR 1: going back

### Task 1: `useCanGoBack` and the web's `BackButton`

**Files:**
- `libs/raven/ui/src/components/Player/useLeave.ts`;
- a new `libs/raven/ui/src/lib/useCanGoBack.ts` (or beside `useLeave`, matching where the package keeps hooks), exported from `libs/raven/ui/src/index.ts`;
- a new `apps/raven/web/src/components/BackButton/BackButton.tsx` with its `.module.scss` and `.test.tsx`.

**`useCanGoBack(): boolean`:**
- A type guard `hasHistoryIndex(state: unknown): state is { idx: number }`, true for an object whose `idx` is a number.
- When `window.history.state` passes it, answer `state.idx > 0`. That is react-router's BrowserRouter, where the index survives reloads and `replace`.
- Otherwise answer `useLocation().key !== 'default'`. That is a memory router: the desktop app and the tests.
- Call `useLocation()` unconditionally, so the hook re-renders on every navigation.
- Comment the why in one or two lines: a `replace` gives the first entry a fresh key, so the key alone misreads a deep link that replaced its URL.

**`useLeave(fallback)`** uses `useCanGoBack()` in place of its own key check. Keep its doc comment true.

**`BackButton({ fallback }: { fallback: { to: string; label: string } | null })`:**

| Case | Renders |
| --- | --- |
| `useCanGoBack()` true | `<Button tone="pill" icon="back" onClick={() => navigate(-1)}>Back</Button>` |
| Else, with a fallback | `<ButtonLink tone="pill" to={fallback.to} icon="back">{fallback.label}</ButtonLink>` |
| Else | Nothing |

Accept an optional `className` so a header can place it. Copy the visual treatment from `ItemHeader`'s `.back` and `.backLabel` (`apps/raven/web/src/components/ItemHeader/ItemHeader.module.scss:83-88`), so the label hides at narrow widths the same way. Do not duplicate it: move it into `BackButton.module.scss` and let `ItemHeader` use the component (Task 2).

**Tests:**
- `BackButton.test.tsx`, using `renderWithProviders` (`apps/raven/web/src/test/render.tsx`), inside `<Routes>` so navigation shows:
  1. `behind: ['/movies/3']`, route `/people/7`: shows a button named "Back", and clicking it lands on `/movies/3`. Render a probe route that prints the path.
  2. No `behind`: a link named by the fallback label with `href` equal to `fallback.to`.
  3. No `behind` and `fallback: null`: nothing with the name "Back" or any link.
  4. With `window.history.replaceState({ idx: 2, key: 'k' }, '')` before render and no `behind`: the Back button shows, because the index wins. Restore `window.history.replaceState(null, '')` in `afterEach`.
- `libs/raven/ui/src/components/Player/Player.test.tsx:393-471` keeps passing unchanged.

**Commit:** `MAE: step back through raven's own history`

### Task 2: a Back button on every page

**Files:**
- `apps/raven/web/src/components/ItemHeader/ItemHeader.tsx` and its `.module.scss`;
- the pages under `apps/raven/web/src/pages/`: `LibraryPage` (its `LibraryHeader.tsx`), `HistoryPage`, `LibrariesPage`, `PersonPage`, `FavouritesPage`, `SettingsPage`, `DesignPage`, `NotFoundPage`, `HomePage`;
- their tests.

**Changes:**
- `ItemHeader` renders `<BackButton fallback={back} className={styles.back} />` in place of its `ButtonLink` (line ~207). Its `back` prop keeps its shape. Delete the now-unused `.back` and `.backLabel` rules if `BackButton` owns them.
- Each other page places `BackButton` first in its header, in a named grid area (`back`) of that header's grid, above the title. Fallbacks:

  | Page | Fallback |
  | --- | --- |
  | `LibraryPage` (`LibraryHeader.tsx`) | `{ to: '/libraries', label: 'Libraries' }` |
  | `HistoryPage` | `{ to: '/libraries/<id>', label: <library name> }`, replacing its present link (`HistoryPage.tsx:87`) |
  | `LibrariesPage`, `PersonPage`, `FavouritesPage`, `SettingsPage`, `DesignPage`, `NotFoundPage` | `{ to: '/', label: 'Home' }` |
  | `HomePage` | `null` |

  `LibraryPage.tsx:37` already links to `/libraries`; replace that link rather than adding a second one.
- Keep each header's layout tidy at 320px. Use the header's existing grid; add a `back` row to its `grid-template-areas`.

**Tests:**
- Update the tests that assert the old fixed links (`HistoryPage.test.tsx:68`, any `ItemHeader`, `ShowPage`, `SeasonPage`, `SagaPage` or `PlayableItemView` test asserting the back `href`). With no `behind`, they still find the fallback link.
- Add one test with `behind` to `PersonPage.test.tsx` showing the "Back" button.
- `HomePage` with no `behind` shows no Back.

**Commit:** `MAE: put a Back button on every raven page`

---

## PR 2: folders

### Task 3: folders grouped by parent on a library card

**Files:**
- new `apps/raven/web/src/lib/folders.ts` and `folders.test.ts`;
- `apps/raven/web/src/pages/LibrariesPage/LibrariesPage.tsx` (lines ~100-108);
- `LibrariesPage.module.scss` (`.paths` and `.path`, lines ~141-159);
- `LibrariesPage.test.tsx`.

**`groupFolders(paths: readonly string[]): Array<{ parent: string; names: string[] }>`:**
- Split each path at its last `/`.
- The parent is everything before it, or `/` when that is empty. The name is everything after it.
- Group by parent in the order parents first appear, keeping each name's order.
- Use `reduce`; no loops.

**Render:** keep `<ul className={styles.paths} aria-label="Folders">`. Each group is an `<li className={styles.path}>` holding:
- `<span className={styles.parent}>{parent}</span>`;
- `<span className={styles.names}>{names.join(' · ')}</span>`.

**Style:**
- `.paths` is a grid with `grid-template-columns: max-content minmax(0, 1fr)` and column and row gaps from the `--space-*` tokens.
- Each `.path` spans both columns with `grid-column: 1 / -1` and `grid-template-columns: subgrid`, so the parents line up. This is an auto-placed collection, so line placement is allowed.
- `.parent` uses the mono font token and the muted colour.
- `.names` uses the body font with `overflow-wrap: anywhere`.
- Drop the chip background.
- In the existing 40rem container query, `.paths` becomes one column and each `.path` stacks the parent above the names.
- Check the result at 320px and on a card with one folder.

**Tests:**
- `folders.test.ts`:
  - one path gives one group with one name;
  - the TV Shows library's seven paths give four groups in order:
    1. `/media/vermithor/Media` with `TV` and `Mini-Series`
    2. `/media/caraxes/Media` with `TV` and `Reality TV Shows`
    3. `/media/syrax/Media` with `Sitcoms` and `Classics`
    4. `/media/meleys/Media` with `Documentary Shows`
  - `/media` gives the parent `/`.
- `LibrariesPage.test.tsx`: a library with two paths under one parent renders one list item holding both names.

**Commit:** `MAE: group a raven library's folders by parent`

---

## PR 3: a person's filmography on the server

### Task 4: the contract and core helpers

**Files:**
- `libs/raven/core/src/contract.ts`;
- new `libs/raven/core/src/filmography.ts` and `filmography.test.ts`;
- `libs/raven/core/src/index.ts` (exports);
- `libs/raven/core/src/apiClient.ts`;
- `contract.test.ts` and `apiClient.test.ts`;
- the fixtures: `libs/raven/core/src/test/fixtures.ts`, `apps/raven/web/src/test/fixtures.ts`, `apps/raven/web/src/pages/DesignPage/samples.ts`, and any server test fixture that builds a `PersonDetails`.

**Contract** (near `isPersonDetails`, line ~742):
- `isPersonProfile = object({ imdbId, birthday, deathday, placeOfBirth, biography, knownFor })`. Every field is `nullable(isString)`, and `birthday` and `deathday` are `YYYY-MM-DD`.
- `isFilmographyDepartment = oneOf(['acting', 'directing', 'writing', 'producing', 'crew'])`.
- `isFilmographyCredit = object({ department: isFilmographyDepartment, role: nullable(isString), episodes: nullable(isNumber), isSelf: isBoolean })`.
- `isFilmographyEntry = object({ type: isMatchItemType, tmdbId: isString, title: isString, year: nullable(isNumber), released: nullable(isString), poster: nullable(isString), credits: listOf(isFilmographyCredit), item: nullable(isItemSummary) })`.
- `isPersonFilmography = union(...)` of:
  - `object({ state: oneOf(['ready']), fetchedAt: isString, entries: listOf(isFilmographyEntry) })`
  - `object({ state: oneOf(['pending']) })`
  - `object({ state: oneOf(['unavailable']) })`

  Use whatever `union` form `schema.ts` offers; read it first.
- `isPersonDetails` gains `tmdbId: isString`, `profile: nullable(isPersonProfile)` and `filmography: isPersonFilmography`. `credits` stays as it is.
- Export each type: `PersonProfile`, `FilmographyDepartment`, `FilmographyCredit`, `FilmographyEntry`, `PersonFilmography`.

**`filmography.ts`:**
- `FILMOGRAPHY_TABS = ['all', 'acting', 'directing', 'writing', 'producing'] as const` and `isFilmographyTab = oneOf(FILMOGRAPHY_TABS)`. Match how core builds a guard from an `as const` list elsewhere.
- `entriesOn({ entries, tab, isSelfShown }): FilmographyEntry[]`:
  - Drop the credits with `isSelf` unless `isSelfShown`.
  - On a tab other than `all`, keep only the credits of that department.
  - Drop the entries left with no credits.
  - Keep the order.
- `tabCounts({ entries, isSelfShown }): Record<FilmographyTab, number>`, from `entriesOn` per tab.
- `selfCount(entries)`: the entries all of whose credits are `isSelf`. The page shows the toggle only when it is above 0.
- `ageOn({ birthday, on }): number | null`:
  - Whole years between two `YYYY-MM-DD` strings.
  - `null` when either is null or does not match `/^\d{4}-\d{2}-\d{2}$/`.
  - A birthday later in the year than `on` has not come yet.
  - Parse with string slicing and `Number`, not `Date`, so it is time-zone free.

**`apiClient.ts`:** `tmdbPosterSources(poster: string): { src: string; srcSet: string }`, built from `/api/images/poster${poster}?w=<width>` for the poster widths core already names (`posterWidthFrom`, contract line ~783). Match how `posterSources` in the web builds a `srcSet`, and keep `src` at the middle width.

**Fixtures:** every `PersonDetails` fixture gains `tmdbId: '<n>'`, `profile: null` and `filmography: { state: 'unavailable' }`, so the present person page keeps working.

**Tests:**
- `contract.test.ts`: accepts each of the three filmography states; rejects a `ready` with no `entries`; rejects an entry whose `type` is `season`.
- `filmography.test.ts`:
  - `entriesOn`: the `all` tab with selves hidden drops a talk-show entry; the `acting` tab keeps only acting credits of an entry with acting and producing; toggling selves on brings the talk-show entry back.
  - `tabCounts`.
  - `ageOn`:
    - `2000-11-21` on `2026-10-17` is 25;
    - on `2026-11-21` it is 26;
    - `1956-07-09` on `2026-07-08` is 69;
    - a null or malformed date gives null.
- `apiClient.test.ts`: `tmdbPosterSources('/abc.jpg')`.

**Commit:** `MAE: describe a person's filmography in raven's contract`

### Task 5: TMDB person fetch and migration 27

**Files:**
- `apps/raven/server/src/db/database.ts`;
- `apps/raven/server/src/test/queryPlans.test.ts`;
- `apps/raven/server/src/metadata/tmdbClient.ts` and `tmdbClient.test.ts`;
- `apps/raven/server/src/test/fakeTmdb.ts`.

**Migration 27**, appended to `MIGRATIONS`:

```sql
ALTER TABLE people ADD COLUMN imdb_id TEXT;
ALTER TABLE people ADD COLUMN birthday TEXT;
ALTER TABLE people ADD COLUMN deathday TEXT;
ALTER TABLE people ADD COLUMN place_of_birth TEXT;
ALTER TABLE people ADD COLUMN biography TEXT;
ALTER TABLE people ADD COLUMN known_for TEXT;
ALTER TABLE people ADD COLUMN filmography_fetched_at TEXT;
CREATE TABLE person_credits (
  person_id INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  credit_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('movie', 'show')),
  tmdb_id TEXT NOT NULL,
  title TEXT NOT NULL,
  released TEXT,
  poster TEXT,
  genre_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genre_ids)),
  department TEXT NOT NULL,
  role TEXT,
  episodes INTEGER,
  position INTEGER NOT NULL,
  PRIMARY KEY (person_id, credit_id)
);
```

Add `'person_credits'` to `NOT_IN_THE_COPY`. Follow the house style of the neighbouring migrations, such as comments and `STRICT` if they use it.

**TMDB client:**
- Types:
  - `FetchedPerson = { tmdbId, name, photo, imdbId, birthday, deathday, placeOfBirth, biography, knownFor, credits: FetchedPersonCredit[] }`.
  - `FetchedPersonCredit = { creditId, type: 'movie' | 'show', tmdbId, title, released, poster, genreIds: number[], department, role, episodes, position }`.
  - Derive the `type` union from the contract's `MatchItemType` if it is exported.
- `export const toPerson = (body: unknown): FetchedPerson | null`. Reuse the file's `records`, `text`, `idOf`, `imagePath` and `yearOf` helpers. It maps cast first, then crew:
  - `media_type: 'tv'` becomes `show`, and any other media type is dropped.
  - `adult: true` is dropped.
  - A credit with no id, no title, or a repeated `credit_id` is dropped.
  - Title: `title`, else `name`.
  - Released: `release_date`, else `first_air_date`, with an empty string as null.
  - Cast: `department: 'Acting'`, `role` = `character`, with an empty string as null.
  - Crew: `role` = `job`.
  - `episodes` = `episode_count`, or null.
  - `position` = the index in the combined list.
  - `imdbId`: from `imdb_id`, else `external_ids.imdb_id`, with empty as null.
  - Empty strings are null for `biography` and `placeOfBirth` too.
- `async person(tmdbId: string): Promise<FetchedPerson>` calls `/person/{id}` with `append_to_response: 'combined_credits,external_ids'` through the client's `get` (same rate limit, language and auth). A 404 throws the same `TmdbError` `not-found` the other calls use; a body `toPerson` rejects throws as the other calls do.
- `fakeTmdb.ts`:
  - a `people?: FakePerson[]` option, with a `/person/(\d+)` route answering the TMDB shape above;
  - a `holdPerson(id)` that delays that one answer until released, modelled on any existing `hold`;
  - a call counter.

  Give Keanu Reeves (who is in the fake movie credits) a fake person with:
  - a cast credit on The Matrix (603);
  - a TMDB-only movie with a poster;
  - a `tv` credit with `episode_count`;
  - a talk-show `Self` credit with `genre_ids: [10767]`;
  - a crew `Executive Producer` credit;
  - a crew `Thanks` credit.

**Tests** (`tmdbClient.test.ts`): `toPerson` covers tv becoming show, adult dropped, a missing title dropped, a repeated `credit_id` dropped, crew role from job, empty strings as null, and the `imdbId` fallback. `person()` against the fake answers the mapped person, and a 404 throws `not-found`.

**Commit:** `MAE: fetch a person and their credits from TMDB`

### Task 6: filmographies, served

**Files:**
- new `apps/raven/server/src/people/peopleRepository.ts`, `filmography.ts`, `filmographies.ts` and their tests;
- `apps/raven/server/src/metadata/metadataRepository.ts` (`librariesHoldingEach`, `clearUp`);
- `apps/raven/server/src/items/peopleController.ts`;
- `apps/raven/server/src/items/matchController.ts` (poster `?w=`);
- `apps/raven/server/src/appModule.ts`;
- `apps/raven/server/src/metadata/movies.test.ts`, `metadataRepository.test.ts` and `appLock.test.ts`.

Read first: `peopleController.ts`, `MetadataRepository.person`, `credits`, `summaries` and `clearUp`, `lock/lockService.ts`, `metadata/matchFactsCache.ts` (the deadline race pattern) and `scanner/concurrency.ts` (`createGate`).

**`PeopleRepository`** (`@Inject` the database token as the other repositories do):
- `profile(personId)` answers `{ tmdbId, profile: PersonProfile | null, fetchedAt: string | null }`. The profile is null until a filmography has been fetched.
- `saveFilmography({ personId, person: FetchedPerson, at })`, in one transaction:
  1. update `people` (name, photo, the profile columns, `filmography_fetched_at = at`);
  2. delete the person's `person_credits`;
  3. insert the new rows, with `genre_ids` as `JSON.stringify`.
- `filmographyRows(personId)` is the rows ordered by `position`, each with `itemId`, from `LEFT JOIN items i ON i.type = pc.type AND i.tmdb_id = pc.tmdb_id`.

**`MetadataRepository`:**
- `librariesHoldingEach(itemIds: readonly number[]): Map<number, number[]>`. One recursive query from `json_each(?)` through the file's `under()` pattern to `media_items` and `media`, answering the distinct library ids holding files under each root id.
- `clearUp()` deletes from `people` only the rows with no `credits` and with `filmography_fetched_at` null or older than 180 days. Use a prepared statement taking the cutoff.

**`filmography.ts`** (pure, no Nest):
- `IGNORED_JOBS = ['Thanks', 'In Memory Of'] as const`.
- `departmentOf({ department, role })`, checked in this order:
  1. `Acting` → `acting`
  2. a role containing `Producer` → `producing`
  3. `Directing` → `directing`
  4. `Writing`, or `Creator` (department or role) → `writing`
  5. anything else → `crew`
- `SELF_ROLE = /^\s*(self|him\s*self|her\s*self|them\s*sel(f|ves)|host|co-host|guest host|presenter)\b/i` and `SELF_GENRES = [10767, 10763]`.
- `isSelfAppearance({ department, role, genreIds })` is true for an `Acting` credit whose genres meet `SELF_GENRES`, or whose role matches `SELF_ROLE`.
- `toEntries({ rows, holding, sees, summaries, localCredits })`:
  - `rows` are `filmographyRows`.
  - `holding` is `librariesHoldingEach` over their item ids.
  - `sees(libraryId)` is the viewer's `seesLibrary`.
  - `summaries` maps item id to `ItemSummary`.
  - `localCredits` are `PersonDetails['credits']`, already filtered for the viewer.

  It works as follows:
  1. Drop `IGNORED_JOBS` rows.
  2. Group the rows by `type:tmdbId`, keeping the first row's title, released, poster and year (`yearOf`, or the first four digits).
  3. Map each row to a credit `{ department: departmentOf(...), role, episodes, isSelf }`, with acting credits first.
  4. Set `item` to the summary when one of the item's holding libraries passes `sees`; otherwise null.
  5. Then, for each local credit whose item id matches no row's `itemId`, add an entry from its `ItemSummary`:
     - `tmdbId`: the item's `items.tmdb_id`. `ItemSummary` carries none, so the server-side read of local credits also returns each item's `tmdb_id` (a server-only field, not added to the contract's `credits`).
     - `released: null` and `poster: null`; the page draws the item's own poster.
     - The local job maps to a department: cast and guest to acting, director to directing, writer and creator to writing, producer to producing.
     - `isSelf: false`.
     - `item` is that summary.
  6. Order: entries with no `released` first, then `released` descending, then title.
- Export `toProfile(row)` if it keeps the controller small.

**`Filmographies`** (`@Injectable`). It injects `TmdbClient` (typed as `Pick<TmdbClient, 'enabled' | 'person'>`, so a test can pass a stub), `PeopleRepository` and `MetadataRepository`, and holds:
- `FRESH_DAYS = 14`, `FAILURE_MEMORY_MS = 600_000`, `DEADLINE_MS = 2500`;
- `inFlight: Map<number, Promise<void>>`;
- `createGate({ limit: 2 })`;
- `failedAt: Map<number, number>`.

Methods:
- `ensure({ personId }): Promise<void>`:
  - **Fresh:** return.
  - **Stale:** start a background refresh (single-flight, through the gate, errors recorded in `failedAt` and caught) and return at once.
  - **Never fetched, TMDB enabled, not failed in the last 10 minutes:** start or join the single-flight fetch and race it against `DEADLINE_MS`, as `MatchFactsCache` does. No rejection may float.
- `state({ personId }): 'ready' | 'pending' | 'unavailable'`:
  - `ready` when rows exist (`fetchedAt` set);
  - `pending` when a fetch for this person is in flight;
  - `unavailable` otherwise.

The fetch calls `tmdb.person(tmdbId)` and `people.saveFilmography({ personId, person, at: new Date().toISOString() })`.

**`peopleController.ts` `GET /api/people/:id`** becomes `async`:
1. 404 as today.
2. `await filmographies.ensure({ personId: id })`.
3. Build `credits` as today.
4. Build `filmography`:
   - `ready`: `{ state, fetchedAt, entries: toEntries(...) }` with `sees` from `lock.viewer({ cookie }).seesLibrary`.
   - Otherwise `{ state }`.
5. Answer `{ ...person, tmdbId, profile, filmography }`.

Check the controller's cache-control: it must never be `public`.

**`matchController.ts` `GET /api/images/:use/:file`:** for `use === 'poster'`, read `?w=` with `posterWidthFrom` as `itemsController.ts:312-318` does. Unknown widths answer 400, and no `w` keeps today's width.

**`appModule.ts`:** register `PeopleRepository` and `Filmographies`.

**Tests:**
- `people/filmography.test.ts`:
  - `departmentOf` for: Acting, Executive Producer, Producer, Executive Co-Producer, Director, Screenplay, Creator, Production Manager (crew), Editor (crew);
  - `isSelfAppearance`: `Self`, `Self - Guest`, `Himself (archive footage)`, `Host` and a Talk-genre character are true; `Narrator (voice)`, a drama character and a crew credit are false;
  - `toEntries`:
    - groups two cast credits on one show;
    - puts acting first;
    - drops `Thanks`;
    - sets `item` only when a seen library holds it;
    - adds a local-only credit;
    - orders undated first.
- `people/filmographies.test.ts` (stub TMDB, short deadline injected or faked timers):
  - `ready` after `ensure`;
  - `pending` when the fetch outlasts the deadline, then `ready`;
  - `unavailable` when TMDB is disabled or fails, with no retry within 10 minutes;
  - stale data served and refreshed in the background;
  - two concurrent `ensure` calls make one TMDB call.
- `metadataRepository.test.ts`:
  - `librariesHoldingEach` reaches a show through its episodes' files;
  - `clearUp` keeps a person with no credits fetched yesterday and deletes one fetched 200 days ago;
  - deleting a person deletes their `person_credits`.
- `movies.test.ts` (extend "serves a person's page"):
  - Keanu's filmography is `ready`, with the profile filled;
  - The Matrix's entry has an `item` with id and title;
  - the TMDB-only movie has `item: null` and its poster path;
  - the talk-show entry has `isSelf: true`;
  - with TMDB down from the start, the answer is `unavailable` with today's `credits`;
  - `/api/images/poster/<file>?w=185` answers 200, and `?w=200` answers 400.
- `appLock.test.ts`: with a locked library holding The Matrix, the entry's `item` is null without the PIN and set with it.

**Commit:** `MAE: serve a person's whole filmography from TMDB`

---

## PR 4: the person page

### Task 7: the person page with its table

**Files:**
- `apps/raven/web/src/pages/PersonPage/PersonPage.tsx`, `PersonPage.module.scss` and `PersonPage.test.tsx`;
- `apps/raven/web/src/lib/queries.ts` (`personQuery`, line ~150).

Split new pieces into files beside the page when they pass about 150 lines: `PersonHeader.tsx`, `FilmographyTable.tsx`, `FilmographyToolbar.tsx`.

Read first:
- `apps/raven/web/src/components/ShowCard/ShowViews.tsx`, the sortable table pattern (`SortHeader`, `useTableSort`, `SortColumn`), and its `.module.scss` container queries;
- `pages/LibraryPage/LibraryTabs.tsx`, the link tabs;
- `lib/useSearch.ts` (`useAddressSearch`) and `components/SearchField`;
- `lib/posters.ts` and `lib/itemLinks.ts`;
- `components/TmdbCredit`.

**Query:** `personQuery` refetches every 1,500 ms while `data.filmography.state === 'pending'` (TanStack's `refetchInterval` as a function), and not otherwise.

**Header** (`<header>` with named grid areas `back`, `photo`, `named`, `facts`, `bio`, `links`):
- `BackButton` with `{ to: '/', label: 'Home' }`.
- The photo as today, with initials when there is none.
- **Eyebrow:** `profile.knownFor` when set, then `· <n> on raven` where n counts entries with an `item`, using `plural` (`'title'`/`'titles'`): "Acting · 5 titles on raven". With a filmography that is not `ready`, keep today's "In your libraries · N credits".
- The `<h1>` name.
- **Facts line**, only when `profile?.birthday`:
  - living: `Born <date> in <place> · <age> years old`;
  - dead: `Born <date> in <place> · Died <date>, aged <age>`.

  Leave out ` in <place>` with no place and the age part when `ageOn` is null. `<date>` is `new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' })` over `Date.UTC` built from the string's parts. The age is `ageOn({ birthday, on: deathday ?? today })`, where today is the local `YYYY-MM-DD`.
- **Biography:** a `<p>` clamped to four lines with `line-clamp`. A `<button aria-expanded>` "More" or "Less" shows only when the text overflows; measure `scrollHeight > clientHeight` after layout, or always show it past 400 characters if measuring is awkward in happy-dom.
- **Links**, each with `target="_blank" rel="noreferrer"`:
  - "IMDb" to `https://www.imdb.com/name/<imdbId>/` when `imdbId` is set;
  - "TMDB" to `https://www.themoviedb.org/person/<tmdbId>`.

**Toolbar:**
- `SearchField` with `useAddressSearch`, labelled "Search titles" (visually hidden label) and with the placeholder "Search titles".
- **Toggle:** a checkbox labelled "Show appearances as themselves". It shows only when `selfCount(entries) > 0`, and its state lives in component state, default off.
- **Tabs:** `<nav aria-label="Credits">` with a `Link` per `FILMOGRAPHY_TABS` entry whose count is above 0 (always All). Labels All, Acting, Directing, Writing, Producing, with the count in a span `aria-hidden` as `LibraryTabs` does.
  - Each link sets `?credits=<tab>` (omit for `all`), keeps `?q=`, and passes `replace`.
  - The current tab gets `aria-current="page"`.
  - Read the tab from the address with `isFilmographyTab`, falling back to `all`.

**Table** (`<table aria-label="Filmography">`):

| Column | Content |
| --- | --- |
| Year | `year`, else `TBA` |
| Title | A small poster (`posterSources` from the item when set, else `api.tmdbPosterSources(poster)`, else the first letter as `ShowViews` does), the title, and a small mark "Movie" or "TV". The title links to `itemPath(item)` when `item` is set, else to `https://www.themoviedb.org/<movie or tv>/<tmdbId>` with `target="_blank" rel="noreferrer"`. |
| Role | Each visible credit's role joined by " · ", then on a second line `<n> episodes` (`plural`) when a credit has `episodes` |
| Department | All tab only. The distinct department labels (Acting, Directing, Writing, Producing, Crew) joined by " · " |
| On raven | With an item, a link "On raven" to `itemPath(item)`, styled as a small pill on the leaf tokens (`--color-leaf` with `--color-on-leaf`). Otherwise the muted text "Not on raven". |

- Sortable with `useTableSort`:
  - Year (on `released`, nulls first when descending, first `desc`);
  - Title (`sortTitle`, first `asc`);
  - On raven (item present first, first `desc`).
- The default order is the server's.
- **Search:** filter the visible entries whose title or visible roles include the query, case-insensitive. Reuse an existing normalizer in `apps/raven/web/src/lib` if the library search has one.
- **Containers:** the table sits in a container like `ShowViews`' `.room`. Department hides below 48rem and Role below 30rem.
- **Copy:**
  - A search with no match: `No titles match "<q>".`
  - A `ready` filmography with no entries: `TMDB lists no titles for <name>.`

**States:**
- `pending`: the header (from `credits` as today), then a `Loading` skeleton of table rows labelled `Fetching <name>'s filmography`.
- `unavailable`: today's grouped poster grid from `groupCredits`, after the note `TMDB could not be reached, so this lists only what raven holds.`, and today's empty message when there are no credits.
- Keep `<TmdbCredit />` at the end.

**Tests** (`PersonPage.test.tsx`; keep `groupCredits` and `initialsOf` tests):
- **Living person:** the facts line reads `Born November 21, 2000 in Santa Monica, California, USA · 25 years old` (or the locale form the test environment's `Intl` gives; assert on the parts if needed). Fix "today" with `setSystemTime` from `bun:test`.
- **Dead person:** `Died ..., aged ...`.
- **Tabs:**
  - counts shown;
  - clicking Acting leaves only acting rows;
  - Producing hidden when empty.
- **Search:** filters rows after the debounce (`await` the debounce or press Enter).
- **Toggle:** the talk-show row appears only after checking the toggle.
- **On raven:** a row with an item links to `/movies/1`, and one without shows "Not on raven".
- **Pending:** the skeleton is labelled.
- **Unavailable:** the note and today's grid.

**Commit:** `MAE: show a person's details and whole filmography`

---

## PR 5: ratings from MDBList

> Before Task 8, the controller runs the MDBList spike with the user's key and records the results in the spec's Spike section. Tasks 8 to 10 take the endpoint, field names and limits from there.

### Task 8: the MDBList client and the score source seam

**Files:**
- `apps/raven/server/src/config.ts` and `config.test.ts`;
- new `apps/raven/server/src/metadata/scoreSources.ts`;
- new `apps/raven/server/src/metadata/mdblistClient.ts` and `mdblistClient.test.ts`;
- `apps/raven/server/src/metadata/omdbClient.ts` and its tests;
- `apps/raven/server/src/test/fakeTmdb.ts`;
- `apps/raven/.env.example`, and the README's environment table and its scores paragraph.

**Config:** `mdblistApiKey: string | null` from `MDBLIST_API_KEY` (trimmed, empty is null) and `mdblistDailyLimit` from `MDBLIST_DAILY_LIMIT` (at least 1, default 1000), modelled on `omdbApiKey` and `omdbDailyLimit`.

**`scoreSources.ts`:**
- `ScoreProvider = 'omdb' | 'mdblist'`;
- `ExternalScore = { source: Exclude<RatingSource, 'tmdb'>; value: number; votes: number | null }`;
- `ScoreSource = { provider: ScoreProvider; enabled: () => boolean; remaining: () => number; state: () => MetadataServiceState; lookUp: (title: { type: MatchItemType; tmdbId: string; imdbId: string | null }) => Promise<ExternalScore[] | 'unknown'> }`.

A failure throws; `'unknown'` is an answer.

**`MdblistClient implements ScoreSource`:**
- Fetches through the same fetch token `OmdbClient` uses.
- `export const parseMdblistRatings(body: unknown): ExternalScore[]`, using the spike's field names:
  - `imdb`: `value` out of 10, `votes`;
  - `tomatoes`: score / 10 to one decimal;
  - `metacritic`: score / 10 to one decimal;
  - every other source and every null score dropped.
- In-memory daily budget like `OmdbClient`'s.
- `createRateLimit({ perSecond: 3, inFlight: 2 })` from `scanner/concurrency.ts`.
- A 401 refuses the key until restart (`state()` `failing`, `enabled()` false). A 429 marks the day spent (`remaining()` 0 until UTC midnight).
- `lookUp` answers `'unknown'` for the spike's not-found answer.

**`OmdbClient`** implements `ScoreSource` too:
- `lookUp` answers `'unknown'` with no `imdbId`, and otherwise its present parse as `ExternalScore[]`.
- Replace `OmdbScore` with `ExternalScore`.

**Fake:** `fakeTmdb.ts` gains an MDBList route on the spike's host and path, with `mdblist: Record<string, FakeMdblist>` keyed `movie:<id>` or `show:<id>`, an `mdblistCalls` counter and an `mdblistSpent` switch answering 429.

**Tests** (`mdblistClient.test.ts`):
- parse;
- unknown title;
- off without a key;
- the budget counts down and stops at the limit;
- 401 refuses;
- 429 spends the day, and it resets after midnight with `vi.setSystemTime`.

**Commit:** `MAE: ask MDBList for Rotten Tomatoes and Metacritic scores`

### Task 9: rating provenance and the combined fetch

**Files:**
- `apps/raven/server/src/db/database.ts` (migration 28);
- `metadata/metadataRepository.ts` (`saveScores`, `scoresDue` replacing `needingScores`);
- rename `metadata/omdbScores.ts` to `metadata/scores.ts` (`Scores`);
- `metadata/matchPass.ts`, `metadata/itemRefresher.ts`, `metadata/metadataService.ts`, `appModule.ts`;
- the tests that build `OmdbScores`;
- `metadataRepository.test.ts`, `shows.test.ts`, `movies.test.ts`;
- new `metadata/scores.test.ts`.

**Migration 28:**

```sql
ALTER TABLE ratings ADD COLUMN provider TEXT NOT NULL DEFAULT 'tmdb';
UPDATE ratings SET provider = 'omdb' WHERE source <> 'tmdb';
ALTER TABLE items ADD COLUMN mdblist_fetched_at TEXT;
```

**`saveScores({ itemId, provider, scores })`**, in one transaction:
1. `UPDATE items SET omdb_fetched_at | mdblist_fetched_at = ? WHERE id = ?`. With no row changed, return; the item is gone, and the foreign key would throw.
2. Delete the provider's own omissions: `DELETE FROM ratings WHERE item_id = ? AND provider = ? AND source <> 'tmdb' AND source NOT IN (SELECT value FROM json_each(?))`.
3. Upsert each score: `INSERT ... ON CONFLICT (item_id, source) DO UPDATE SET value = excluded.value, votes = excluded.votes, provider = excluded.provider WHERE ratings.provider = excluded.provider OR excluded.provider = 'mdblist'`.

**`scoresDue({ provider, before, limit })`:** movies and shows whose `tmdb_id` does not start with `local:`.
- **MDBList:** due when `mdblist_fetched_at < before`, or never asked. Order first the never-asked missing an RT or Metacritic row, then the never-asked, then the oldest.
- **OMDb:** due when `imdb_id` is set and the later of the two stamps is older than `before`, oldest first.

**`Scores`:**
- `primary(): ScoreSource | null` is MDBList when enabled, else OMDb when enabled, else null.
- `fetch({ itemId, type, tmdbId, imdbId }): Promise<boolean>` asks the primary:
  - if it answers `'unknown'` and it is MDBList, ask OMDb when enabled;
  - save each answer under its provider;
  - answer true when some provider answered.

`matchPass.ts` and `itemRefresher.ts` call it where they called `OmdbScores.fetch`.

**Tests:**
- `scores.test.ts` with fake sources:
  - MDBList answers, and OMDb is not asked;
  - MDBList answers unknown, and OMDb fills in;
  - MDBList off or refused makes OMDb the primary;
  - both spent, nothing called.
- `metadataRepository.test.ts`:
  - OMDb without RT keeps MDBList's RT;
  - OMDb's IMDb does not overwrite MDBList's;
  - MDBList replaces OMDb's RT;
  - MDBList without Metacritic deletes its own old Metacritic;
  - `saveScores` for a deleted item does nothing;
  - `scoresDue` order per provider, with local items left out.
- `shows.test.ts`: with `mdblistApiKey` set, a show gains RT and Metacritic and the OMDb call count stays 0. The OMDb-only tests stay as they are.

**Commit:** `MAE: keep each ratings provider's scores apart`

### Task 10: the score sweep and health

**Files:**
- new `apps/raven/server/src/metadata/scoreSweep.ts` and `scoreSweep.test.ts`;
- `metadata/itemRefresher.ts`;
- `metadata/metadataService.ts` (`health()`);
- `libs/raven/core/src/contract.ts` (`isMetadataHealth` gains `mdblist: isMetadataServiceState`);
- the fixtures;
- `appModule.ts`;
- the test `settle()` helpers that wait for background work.

**`ScoreSweep`:**
- Its own `createTaskQueue({ concurrency: 1 })`.
- `kick()` pushes a drain if none is queued.
- `whenIdle(): Promise<void>`.
- `pause(): { reason: 'budget' | 'unavailable'; resumesAt: string } | null`.
- The drain takes `scoresDue` for the primary, up to its `remaining()`, and fetches two at a time through `Scores.fetch`. When it stops:
  - on a spent budget, it sets the pause to `budget` and schedules a kick at the next UTC midnight plus one minute;
  - on a failure, to `unavailable`, and kicks in 15 minutes.

  Both timers are `unref`'d.
- `onApplicationBootstrap` kicks.

**`ItemRefresher.sweep`:** calls `scoreSweep.kick()` instead of awaiting `fillDue()`. Remove `fillDue` if nothing else uses it.

**Health:** `health()` adds `mdblist` from `MdblistClient.state()`.

**Tests:** `scoreSweep.test.ts` covers:
- a drain to the end;
- a stop at the budget with the pause and a kick after midnight (`vi.setSystemTime` and fake timers);
- a failure pausing as `unavailable`;
- the metadata queue staying free during a long drain (a match completes while a slow source holds the sweep).

Health in `movies.test.ts` or the health test reports `mdblist: 'off'` without a key.

**Commit:** `MAE: top up raven's scores on their own queue`

---

## PR 6: Refresh on the server

### Task 11: the library Refresh route and its status

**Files:**
- `apps/raven/server/src/db/database.ts` (migration 29);
- `queryPlans.test.ts` and `queryPlans.ts`;
- `metadata/metadataRepository.ts`;
- `metadata/tmdbClient.ts` (`score`);
- `metadata/scoreSweep.ts`;
- `libraries/librariesRepository.ts`;
- new `libraries/ratingsRefresh.ts`;
- `libraries/librariesController.ts`;
- `appModule.ts`;
- `libs/raven/core/src/contract.ts` and `apiClient.ts`;
- the fixtures;
- new `apps/raven/server/src/appRefresh.test.ts`;
- the repository tests.

**Migration 29:**

```sql
CREATE TABLE score_requests (
  library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  PRIMARY KEY (library_id, item_id)
);
CREATE INDEX score_requests_item ON score_requests (item_id);
ALTER TABLE libraries ADD COLUMN ratings_refresh_started_at TEXT;
ALTER TABLE libraries ADD COLUMN ratings_refresh_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE libraries ADD COLUMN ratings_refreshed_at TEXT;
```

**`MetadataRepository`:**
- `requestScores(libraryId): number`. A recursive walk up from the library's `media` through `media_items` and `items.parent_id`, then `INSERT OR IGNORE INTO score_requests` for the movies and shows whose `tmdb_id` does not start with `local:`. It answers the rows inserted.
- `requestsLeft(libraryId): number`.
- `saveScores` also deletes the item's `score_requests` in every library. A new `clearRequest(itemId)` handles the TMDB-only case.
- `scoresDue` orders items with a request first and treats them as due whatever their stamps.
- `saveTmdbRating({ itemId, rating })`, as the TMDB part of `save()` does.

**TMDB:** `TmdbClient.score({ type, tmdbId })` calls `/movie/{id}` or `/tv/{id}` with no appends and answers `tmdbRating(body)`. `ScoreSweep` gives each requested item this TMDB fetch as well. With no external provider enabled, a request clears after its TMDB score.

**`LibrariesRepository`:**
- `startRatingsRefresh({ id, at, total })`;
- `ratingsRefresh(id)`;
- `finishRatingsRefreshes(at)`: sets `ratings_refreshed_at = at` and `ratings_refresh_started_at = NULL` where it was started and no requests are left. `ScoreSweep` calls it after each batch.

**`RatingsRefresh`:**
- `start(libraryId)`:
  1. When no refresh is running, `requestScores`, then `startRatingsRefresh` with that total. A total of 0 finishes at once.
  2. Always `scanner.quickScan(libraryId)` and `scoreSweep.kick()`.
- `status(libraryId)` answers the contract's `RatingsRefresh`:
  - `idle` with `finishedAt`;
  - `running` with `done = max(0, total - left)`, `total` and `startedAt`;
  - `waiting` with those plus `scoreSweep.pause()`'s `reason` and `resumesAt`.

**Route:** `@AdminOnly() @Post(':id/refresh') @HttpCode(200) refresh(@Param('id', ParseIntPipe) id: number): Library`. It calls `this.find(id)` first, as `scan` does, then `start`, and answers the library with status. `withStatus` adds `ratingsRefresh` for every library.

**Contract:**
- `isRatingsRefresh`, a `union` of:
  - `object({ state: oneOf(['idle']), finishedAt: nullable(isString) })`
  - `object({ state: oneOf(['running']), done: isNumber, total: isNumber, startedAt: isString })`
  - `object({ state: oneOf(['waiting']), done: isNumber, total: isNumber, startedAt: isString, reason: oneOf(['budget', 'unavailable']), resumesAt: isString })`
- `isLibrary` gains `ratingsRefresh: isRatingsRefresh`.
- `isRefreshingRatings(library)`.
- `apiClient.refreshLibrary(id): Promise<Library>`.
- The fixtures gain `ratingsRefresh: { state: 'idle', finishedAt: null }`.

**Tests:**
- `appRefresh.test.ts`, modelled on `appQuickScan.test.ts`:
  1. Add a file, then POST: 200 with `running` and the full total; the file is indexed; after the sweep goes idle, the state is `idle` with `finishedAt`, and changed fake scores are stored for items fetched under 30 days ago.
  2. `mdblistDailyLimit: 2` with three titles gives `waiting`, `budget`, done 2 of 3; after midnight with `vi.setSystemTime` and a kick, `idle`.
  3. A restart on the same data folder mid-refresh keeps the total and progress.
  4. A second POST does not reset the total.
  5. Deleting the library deletes its requests.
- `metadataRepository.test.ts`: `requestScores` reaches a show through its episodes and leaves out other libraries' titles and local items.
- `librariesRepository.test.ts`: the refresh columns and `finishRatingsRefreshes`.
- `appLock.test.ts` and `adminGuard.test.ts` cover the route generically. Run them and fix whatever they demand.

**Commit:** `MAE: refresh a raven library's files and ratings on request`

---

## PR 7: Refresh in the web

### Task 12: the Refresh button and its progress

**Files:**
- `apps/raven/web/src/components/LibraryActions/LibraryActions.tsx`;
- `apps/raven/web/src/components/ScanStatus/ScanStatus.tsx`, or a new sibling `RatingsStatus.tsx`;
- `apps/raven/web/src/pages/LibrariesPage/LibrariesPage.tsx` and `apps/raven/web/src/pages/LibraryPage/LibraryPage.tsx` (polling);
- `LibraryHeader.tsx` and `LibraryPage.module.scss` (the actions wrap rule);
- `apps/raven/web/src/components/LibraryDialog/LibraryDialog.tsx` (copy at ~414);
- wherever the web shows OMDb's health, if it does;
- the tests.

**`useLibraryActions`** gains `refresh = useMutation({ mutationFn: () => api.refreshLibrary(library.id), onSuccess: (updated) => { queryClient.setQueryData(queryKeys.library(library.id), updated); return afterRescan(queryClient) } })`. Check `afterRescan` fits, or add an `afterRefresh` in `lib/invalidate.ts` that also invalidates the listings.

**`LibraryActions`** renders `<Button disabled={refresh.isPending} title="Look for new files and fetch every title's ratings again" onClick={() => refresh.mutate()}>Refresh{whose}</Button>` inside `<AdminOnly>`, before Rescan.

**Status:** below the scan status on the card and in the header:
- `running`: `Refreshing ratings · <done> of <total>`.
- `waiting`, reason `budget`: `Ratings: <done> of <total> · the rest after midnight UTC (daily limit)`.
- `waiting`, reason `unavailable`: `Ratings: <done> of <total> · waiting for the ratings service`.
- `idle`: nothing new.

Numbers go through the page's `Intl.NumberFormat`. A progress bar like the scan's is optional; match `ScanStatus`.

**Polling:** `LibrariesPage.tsx:150` and `LibraryPage.tsx:87` also poll every 5,000 ms while any shown library's `ratingsRefresh.state === 'running'`, never while `waiting`, and keep 1,500 ms while scanning.

**Header:** with one more button, check the header's `.actions > :nth-child(4)` wrap rule (`LibraryPage.module.scss:77-109`), and the card's actions at 64rem, 40rem and 320px.

**Copy:** `LibraryDialog`'s hint becomes `IMDb, Rotten Tomatoes and Metacritic need MDBLIST_API_KEY or OMDB_API_KEY; shows get Rotten Tomatoes and Metacritic only from MDBList.`, with both names in `<code>`.

**Tests:**
- `LibraryActions` shows Refresh with the admin lock off and hides it with the lock on (the `adminLock` option of `renderWithProviders`).
- Clicking Refresh calls `api.refreshLibrary`.
- The three status texts render.
- `LibrariesPage` polls while running (assert `refetchInterval` behaviour as the existing scanning test does).

**Commit:** `MAE: add Refresh to raven's library actions`
