# raven watched, step 1: the rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A video's watched state is one rule over its plays: a `marked` play, or a `played` one that got to the library's **Watched at**, which is also where the resume spot clears. Every `MediaItem` carries `watched`, seasons and shows carry counts, History reports marks, and `PUT /api/watched` marks or unmarks cards.

**Architecture:**
- `plays.kind` (`played`, `marked`, `cleared`) is the whole state. Nothing is stored on the card: `fileWatched` is an `EXISTS` over `plays_media`, and `cardWatched` widens it to the files that share a card (same item, library and `split`).
- A **card** is what a listing shows as one entry. `WatchedCards` resolves `media` and `item` targets to cards (best file first) in the libraries the viewer sees; `WatchedRepository.set` applies the rule card by card in one transaction, re-reading each card's state.
- Core carries the contract (guards built from `schema.ts` combinators), `watchedStateOf` for the badges and toggles of step 2, and `api.setWatched`.
- The web only gains the new fields in its fixtures; its UI does not change in this PR.

**Tech Stack:** NestJS 12 on Fastify, better-sqlite3 (SQLite 3.53), vitest; `@raven/core` with bun test; web fixtures with bun test.

**Spec:** `docs/superpowers/specs/2026-10-15-raven-watched-design.md`: "The rule", "API", "Server", the core and server parts of "Testing", "Docs", and "Order of work" step 1. Step 2 is `2026-10-15-raven-watched-web.md`, step 3 `2026-10-15-raven-watched-select.md`.

## Global Constraints

- Every rule in the root `CLAUDE.md` holds:
  - no `any`, no casts, no non-null assertions outside tests;
  - `type`, never `interface`; no enums;
  - named exports only;
  - no `for`, `for...of` or `for...in` loops;
  - one object parameter wherever there are two or more;
  - `@/` imports with no extension;
  - no em or en dashes anywhere, comments and copy included.
- raven rules (`apps/raven/CLAUDE.md`):
  - every API shape is an `is<Type>` guard in `contract.ts` built from `schema.ts` combinators, its type read off with `Infer`;
  - a write route is `@AdminOnly()` or `@ForViewers()`; marking is `@ForViewers()`;
  - server constructors inject with explicit `@Inject(Token)`;
  - `libs/raven/core` stays platform-agnostic.
- Comments only for a non-obvious why.
- Run tasks through Nx from the repo root: `bunx nx run @raven/core:test`, `bunx nx run @raven/server:test`, one file with `-- <path>`, `bunx nx run @raven/web:test`, then `typecheck`, `lint:ts`, `format:check` per project, and `bun run verify` before the PR.
- Test first for each task: write the failing test, see it fail for the stated reason, then write the code.
- Commits follow the `commit-format` skill: a `MAE:` subject, a short `-` bullet body written with a heredoc, backticks around code, no agent attribution.
- Branch `raven-watched-server` from `main`. One commit for this step. The PR is the base of the stack.

## Review Focus

- **Two-episode files**: unwatching either episode unwatches both; marking both episodes writes one mark. Pinned in Task 5 (`watchedRepository.test.ts`) and Task 3 (`listShows`).
- **A watched 1080p with an unwatched 720p of one episode**: `nextUnwatched` skips the whole episode. Pinned in Task 3.
- **The threshold is one number**: `report()` clears the spot where `fileWatched` starts counting. Pinned in Task 4 with 56 and 57 of 60 seconds at 95%.
- **Hidden libraries**: `item` targets with a null library skip the ones the viewer may not see, `/next` and the season counts judge only visible libraries, and the answer to `PUT /api/watched` is the same either way. Pinned in Task 5 and Task 3.
- **Query plans**: the watched lookup searches `plays_media` and never scans `plays`. Pinned in `listingPlans.test.ts`; `queryPlans.test.ts` and `PRODUCTION_STATISTICS` keep passing with no new index.
- **Migration**: a library at 80 stays 80, one at 90 becomes 95, and a spot at or past its library's threshold goes while a file of unknown length keeps its spot.

---

### Task 1: The contract, `watched.ts` and the fixtures

**Files:**
- Modify: `libs/raven/core/src/contract.ts`, `libs/raven/core/src/apiClient.ts`, `libs/raven/core/src/libraryKinds.ts`, `libs/raven/core/src/index.ts`
- Create: `libs/raven/core/src/watched.ts`, `libs/raven/core/src/watched.test.ts`
- Modify: `libs/raven/core/src/test/fixtures.ts`, `apps/raven/web/src/test/fixtures.ts`
- Modify (fields only): `apps/raven/web/src/test/tv.ts`, `apps/raven/web/src/pages/DesignPage/samples.ts`, `apps/raven/web/src/lib/history.test.ts`, `apps/raven/web/src/pages/HistoryPage/HistoryPage.test.tsx`, `apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx`
- Test: `libs/raven/core/src/contract.test.ts`, `libs/raven/core/src/apiClient.test.ts`, `libs/raven/core/src/libraryKinds.test.ts`, `libs/raven/core/src/watched.test.ts`

**Interfaces:**
- Produces:
  - `MediaItem.watched: boolean`, `EpisodeSummary.watched: boolean`, `SeasonSummary.watchedCount: number`, `ShowEntry.watchedEpisodes: number`, `HistoryEntry.marked: boolean`.
  - `isWatchTarget` / `WatchTarget` (`{ kind: 'media'; id } | { kind: 'item'; id; libraryId: number | null }`), `isWatchedChange` / `WatchedChange` (`{ watched: boolean; targets: WatchTarget[] }`).
  - `isWatchedState`, `WatchedState`, `watchedStateOf({ watched, total })` (`unwatched` at 0 or an empty total, `watched` at or past the total, else `partly`).
  - `api.setWatched({ watched, targets }): Promise<void>`, `PUT /api/watched`.
  - `DEFAULT_LIBRARY_SETTINGS.watchedPercent = 95`.

- [ ] **Step 1: Write the failing tests**
  - `contract.test.ts`: `isMediaItem` without `watched` fails; `isEpisodeSummary` and `isSeasonSummary` with the new fields pass; a `ShowEntry` without `watchedEpisodes` fails `isShowListing`; `isHistoryEntry` without `marked` fails; `isWatchTarget` takes `media`, an `item` with a library and with `null`, and refuses an `item` with no `libraryId`, an unknown kind and a string id; `isWatchedChange` takes an empty list and refuses a missing direction.
  - `watched.test.ts`: `watchedStateOf` at none, some, all and an empty total; `isWatchedState` takes the three states only.
  - `apiClient.test.ts`: `setWatched` sends `PUT http://nas:8484/api/watched` with the JSON body.
  - `libraryKinds.test.ts`: `DEFAULT_LIBRARY_SETTINGS.watchedPercent` is 95.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/core:test`
Expected: FAIL on the missing guards, the missing module and the default of 90.
- [ ] **Step 3: Write the code**
  - `contract.ts`: add the fields with one-line doc comments, `isWatchTarget` as a `union` of two `object` guards (the `kind` literals matching `isMatchSubject`), `isWatchedChange`, and their types.
  - `watched.ts` as above, exported from `index.ts`.
  - `apiClient.ts`: `setWatched: async ({ watched, targets }: WatchedChange)` that sends `{ watched, targets } satisfies WatchedChange`.
  - Both fixture files gain `watched: false`, `watchedCount: 0`, `watchedEpisodes: 0`, and `watchedPercent: 95`; the web's helper files and tests that build these shapes by hand gain the same fields (and `marked: false`).
- [ ] **Step 4: Run the tests to see them pass**

Run: `bunx nx run @raven/core:test`, `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:test`
Expected: PASS, with the web's coverage floors held.

---

### Task 2: Migration 25 and the SQL fragments

**Files:**
- Modify: `apps/raven/server/src/db/database.ts` (`MIGRATIONS`)
- Modify: `apps/raven/server/src/media/mediaSql.ts`
- Test: `apps/raven/server/src/db/database.test.ts`

**Interfaces:**
- Produces:
  - `plays.kind TEXT NOT NULL DEFAULT 'played' CHECK (kind IN ('played', 'marked', 'cleared'))`.
  - `fileWatched(file: string): string`, replacing `isWatched` and `FURTHEST_JOIN`; assumes `libraries l` is the file's library.
  - `cardWatched({ file, item }: { file: string; item: string }): string`, the card's state for the file `file` whose first item is `item`.

- [ ] **Step 1: Write the failing migration test**

In `database.test.ts`, under `describe('migrations')`, a test that builds a database at `user_version = 24` from `MIGRATIONS.slice(0, 24)` with libraries at 90 and 80, files of duration 100 and one with no duration, spots at 92, 95, 80, 79 and 5000, and one play. After opening with `DatabaseService`: the play has `kind = 'played'`; the libraries read 95 and 80; the spots at 92 (below 95), 79 (below 80) and the unknown-length one remain; a play inserted with kind `skipped` throws.
- [ ] **Step 2: Run it to see it fail**

Run: `bunx nx run @raven/server:test -- src/db/database.test.ts`
Expected: FAIL, no `kind` column.
- [ ] **Step 3: Write migration 25 and the fragments**
  - Migration: the `ALTER TABLE`, `UPDATE libraries SET watched_percent = 95 WHERE watched_percent = 90`, then `DELETE FROM playback_progress` for files with `duration > 0 AND position >= duration * watched_percent / 100.0` (after the update, so the new percent is the threshold).
  - `fileWatched`: `EXISTS (SELECT 1 FROM plays pl WHERE pl.media_id = <file>.id AND (pl.kind = 'marked' OR (pl.kind = 'played' AND <file>.duration > 0 AND pl.furthest >= <file>.duration * l.watched_percent / 100.0)))`.
  - `cardWatched`: the file alone when it has no item, else an `EXISTS` over `media_items x CROSS JOIN media y` of the item's files in the file's library with `y.split IS <file>.split` and `fileWatched('y')`. The CROSS JOIN starts the walk from the item's files, as the version count does.
- [ ] **Step 4: Run it to see it pass**

Run: `bunx nx run @raven/server:test -- src/db/database.test.ts`

---

### Task 3: `watched` in every listing, the counts and `nextUnwatched`

**Files:**
- Modify: `apps/raven/server/src/media/mediaRepository.ts`, `apps/raven/server/src/items/itemChildren.ts`, `apps/raven/server/src/items/itemsController.ts`
- Test: `apps/raven/server/src/media/mediaRepository.test.ts`, `apps/raven/server/src/items/itemChildren.test.ts`, `apps/raven/server/src/media/listingPlans.test.ts`

**Interfaces:**
- Produces:
  - `MediaItem.watched` from `SELECT_COLUMNS` (`cardWatched`), so listings, `getMany`, In progress, favourites, sagas, unmatched and home carry it.
  - `ShowEntry.watchedEpisodes` (distinct watched episodes; a two-episode file counts for both).
  - `MediaRepository.nextEpisode({ showId, libraryIds })`: the first episode with no watched file in `libraryIds`, specials last, best file first, using `MAX(watched) OVER (PARTITION BY episode)`.
  - `MediaRepository.watchedEpisodes(ids): { episodeId; libraryId }[]`.
  - `SeasonSummary.watchedCount` and `EpisodeSummary.watched` from `itemChildren`, counting only libraries the viewer sees.
  - `GET /api/items/:id/next` judged against the visible libraries only.

- [ ] **Step 1: Write the failing tests**

`mediaRepository.test.ts`, `describe('what is watched, card by card')`:
  - `watches a movie's whole card when any one of its files is`;
  - `keeps a split card apart from the files that share the movie`;
  - `shows a file watched and started again as both` (In progress);
  - `carries the flag on a saga's movies`;
  - `counts a show's watched episodes once, a two-episode file watching both`;
  - `skips an episode watched in any one of its files when picking the next`;
  - `judges the next episode by the libraries it is asked about alone`;
  - `answers which episodes are watched, and where`.

`itemChildren.test.ts`: `counts what is watched in the libraries this browser may see only`. `listingPlans.test.ts`: `looks a card's plays up by their file, never reading every play`, asserting a `SEARCH pl USING INDEX plays_media (media_id=?` step and no `SCAN pl`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/media src/items`
Expected: FAIL on the missing fields and the changed `nextEpisode` signature.
- [ ] **Step 3: Write the code**
  - `mediaRepository.ts`: `watched` in `SELECT_COLUMNS` and `MediaRow`; `EPISODE_FILES` joins `libraries l` and selects `fileWatched('m') AS watched`; `listShows` counts `DISTINCT CASE WHEN f.watched = 1 THEN f.episode_id END`; `nextUnwatched({ showIds, libraryIds })` with the window; `watchedEpisodes`.
  - `itemChildren.ts`: one `watchedEpisodes` read for the page's episodes and its seasons' episodes.
  - `itemsController.ts`: inject `LibrariesRepository`, pass the ids the viewer sees to `nextEpisode`.
- [ ] **Step 4: Run them to see them pass**

Run: `bunx nx run @raven/server:test -- src/media src/items src/test/queryPlans.test.ts`

---

### Task 4: `ViewingRepository`: threshold, sittings and history

**Files:**
- Modify: `apps/raven/server/src/media/viewingRepository.ts`
- Test: `apps/raven/server/src/media/viewingRepository.test.ts`

**Interfaces:**
- Produces:
  - `report()` clears the spot at `duration * watched_percent / 100`.
  - `notePlay` continues only `kind = 'played'` plays.
  - `history()`: `plays` counts every kind but `marked`, `furthest` is the furthest `played` play (0 if none), `watched` is `fileWatched`, `marked` is whether a mark is held; a marked video appears, ordered by its mark's time.

- [ ] **Step 1: Write the failing tests**
  - `clears the spot at the library's watched percentage, and not before` (56 and 57 of 60 at 95%);
  - `clears the spot where a lower percentage says, and keeps one a higher percentage allows`;
  - `keeps the spots of a library that saves no progress, even past the threshold`;
  - `never continues a mark or a play set aside, so playing again starts a new play`;
  - `counts real plays in the history, takes furthest from the plays that count, and reports a mark`;
  - `lists a video that was only marked, with no plays, and filters by the rule`;
  - the existing threshold test moves to 57 of 60.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/media/viewingRepository.test.ts`
- [ ] **Step 3: Write the code** as listed under Interfaces.
- [ ] **Step 4: Run them to see them pass**

---

### Task 5: `WatchedCards`, `WatchedRepository` and `PUT /api/watched`

**Files:**
- Create: `apps/raven/server/src/media/watchedCards.ts`, `watchedRepository.ts`, `watchedController.ts`
- Modify: `apps/raven/server/src/appModule.ts` (controller in `CONTROLLERS`, both providers)
- Test: `apps/raven/server/src/media/watchedRepository.test.ts`, `apps/raven/server/src/appWatched.test.ts`, `apps/raven/server/src/app.test.ts` (default 95)

**Interfaces:**
- Produces:
  - `WatchCard = { files: readonly { id; duration }[] }`, best file first.
  - `WatchedCards.resolve({ targets, viewer }): WatchCard[]`: a `media` target is the card of the file's first item (item, library and `split`), or the file alone with no item; an `item` target is a card for each movie and episode under it (`MetadataRepository.itemsUnder`) by item, library and `split`, in `libraryId` or in every library the viewer sees; anything in a hidden library, or naming nothing, resolves to none.
  - `WatchedRepository.set({ cards, watched, at })`: in one transaction, per card, skip when the card is already in the state asked for; watched writes one `marked` play (`furthest` = duration or 0) on `files[0]` and deletes the spots of all the card's files; unwatched deletes the card's marks, sets its `played` plays to `cleared` and deletes the spots.
  - `WatchedController`, `PUT /api/watched`, `@ForViewers()`, `@HttpCode(204)`, `parseBody` with `isWatchedChange`, 400 for no targets or more than `MAX_WATCH_TARGETS` (5000).

- [ ] **Step 1: Write the failing tests**

`watchedRepository.test.ts`:
  - `writes one mark on a card's best file and clears the spots of every file on it`;
  - `leaves a card that is watched already alone, with its spot and no second mark`;
  - `writes one History row for a three-version movie named three times`;
  - `marks a file no one has probed, with no length to record`;
  - `clears the spot even where the library saves no progress`;
  - `marks the cards of a split movie apart`;
  - `marks a two-episode file once for both its episodes`;
  - `marks a whole show, season by season, one mark for each episode`;
  - `unwatches by deleting marks, setting real plays aside and clearing spots`;
  - `leaves the plays of a card in progress alone when it is unwatched already`;
  - `counts a later play again after an unwatch`;
  - `skips a library the viewer may not see, and a target that names nothing`;
  - `marks an item in one library only when asked for that library`.

`appWatched.test.ts` (through `apiFor`, PIN set, admin lock on for the viewer):
  - `answers 204 to a viewer with the admin lock on, and marks the file`;
  - `puts a mark in the history, and takes it out again`;
  - `clears the resume spot of what it marks, and the file is no longer in progress`;
  - `marks every episode under a show, and counts them on the season`;
  - `skips the targets in a locked library without saying so`;
  - `finds a show's next episode among the libraries the browser may see only`;
  - `counts only the libraries the browser may see`;
  - `refuses a body that is not a change, and an empty or oversized list of targets`;
  - `still holds back the writes only the admin makes` (`POST /api/libraries` answers 403).
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/media/watchedRepository.test.ts src/appWatched.test.ts`
Expected: FAIL, the modules do not exist.
- [ ] **Step 3: Write the code** as listed under Interfaces.
- [ ] **Step 4: Run them to see them pass**

Run: `bunx nx run @raven/server:test`
Expected: PASS, the route inventory tests included (`assertRoutesMarked` accepts the new route).

---

### Task 6: Docs and the whole check

**Files:**
- Modify: `apps/raven/README.md` (the resume line, **Watched at**, Recently finished, History), `docs/superpowers/specs/2026-10-12-raven-desktop-design.md` (the resume note)
- The spec and the three plans are committed with this step.

- [ ] **Step 1: Update the docs** to the new rule: **Watched at** 95% clears the spot; marks and set-aside plays in History.
- [ ] **Step 2: Run everything**

Run: `bunx nx run @raven/core:test`, `bunx nx run @raven/server:test`, `bunx nx run @raven/web:test`, then each project's `typecheck`, `lint:ts` (and `lint:css` for the web) and `format:check`, then `bun run verify`.
Expected: all PASS.
- [ ] **Step 3: Commit**

```bash
git add docs apps libs
git commit -F - <<'MSG'
MAE: raven counts watched from one rule, with marks and a shared threshold

- `plays.kind` (`played`, `marked`, `cleared`) and migration 25
- `watched` on every `MediaItem`, counts on seasons and shows
- `PUT /api/watched` marks or unmarks cards
MSG
```
