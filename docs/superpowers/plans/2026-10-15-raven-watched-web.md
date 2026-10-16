# raven watched, step 2: marks and toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every card and page shows whether it is watched, and a viewer can mark or unmark one video, season, show or saga from the card's menu or a toggle on its page. History says "Marked watched" for a mark, and the hints that stated the old rule say the new one.

**Architecture:**
- Two small display components: `WatchedMark` (a check badge in the poster frame, beside `ResumeBar`) for a card that is one video, and `WatchedCount` (the check, or the number left unwatched) for a card that holds many.
- `Watched` toggles are `Button tone="quiet" icon="check"` with `aria-pressed` (`mixed` when partly). Each page derives its state with `watchedStateOf` from `@raven/core`.
- One mutation, `useMediaMutations().watched`, for a `media` target; `item` targets and every bulk mark wait for the server's answer. A `media` target is optimistic through `watchedEdits`, beside `favouriteEdits`.
- Both settle with `afterWatched` in `lib/invalidate.ts`; `afterWatching` also invalidates `items` and `favourites`.

**Tech Stack:** React 19, TanStack Query, SCSS modules, bun test with happy-dom and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-15-raven-watched-design.md`: "What the viewer sees", "Web" (marks and toggles, caches), "Accessibility", the web part of "Testing" up to the select-mode items, and "Order of work" step 2. It builds on step 1 (`2026-10-15-raven-watched-server.md`): `MediaItem.watched`, `EpisodeSummary.watched`, `SeasonSummary.watchedCount`, `ShowEntry.watchedEpisodes`, `HistoryEntry.marked`, `WatchTarget`, `watchedStateOf`, `api.setWatched`.

## Global Constraints

- Every rule in the root `CLAUDE.md` holds:
  - no `any`, no casts, no non-null assertions outside tests;
  - `type`, never `interface`; no enums; named exports only;
  - no `for` loops; one object parameter wherever there are two or more;
  - `@/` imports with no extension, SCSS modules included;
  - `&&` in JSX, never a ternary with a `null` branch;
  - no em or en dashes anywhere, UI copy included.
- CSS:
  - component styles are SCSS modules; layout is grid with `gap` and padding, never flex, never margins;
  - fixed regions are placed with named `grid-template-areas`, overlays by giving several children the same named area (the check shares the poster frame's area with `ResumeBar`);
  - colors, fonts, sizes, spacing and radii come from the tokens in `apps/raven/web/src/styles/globals.scss`; a token is added there only if none fits;
  - desktop-first at `30rem`, `40rem`, `48rem`, `64rem`; works at 320px;
  - no animation is added;
  - visible `:focus-visible` with `--focus-ring`.
- Accessibility: the check is never the only signal. `WatchedMark` carries the hidden text "Watched"; `WatchedCount` carries "6 unwatched episodes" or "Watched"; toggles use `aria-pressed`, `mixed` when partly.
- Copy, binding: menu items "Mark as watched" and "Mark as unwatched"; the toggle's accessible name "Watched"; History note "Marked watched".
- Cards of a history tile leave `WatchedMark` off; their note already says.
- Run tasks through Nx from the repo root: `bunx nx run @raven/web:test`, one path with `-- <path>`, `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts`, `bunx nx run @raven/web:lint:css`, `bunx nx run @raven/web:format`, and `bun run verify` before the PR. Coverage stays above the floors in `apps/raven/web/package.json`.
- Commits follow the `commit-format` skill. Branch `raven-watched-web` from `raven-watched-server`; the PR is stacked on step 1's.

## Review Focus

- **A rewatch** (watched, then started again): expect the check and the resume bar together. Pinned in Task 2.
- **A show with some unwatched**: `WatchedCount` shows the number left, with hidden text "6 unwatched episodes"; none left shows the check; all unwatched shows nothing. Pinned in Task 1.
- **The page toggle on a partly watched season**: `aria-pressed="mixed"`; pressing it marks everything watched, pressing it again unmarks everything. Pinned in Task 4.
- **Optimistic `media` marks**: `watchedEdits` returns the very same reference where nothing changes, sets `position` to 0 and drops the card from In progress. Pinned in Task 3.
- **Item targets and bulk marks are not patched**: counts and `next` cannot be, so they wait and then `afterWatched` refetches. Pinned in Task 3.
- **An episode finished in the player** shows watched on its season page afterwards (`afterWatching` invalidates `items`). Pinned in Task 3.

---

### Task 1: `WatchedMark` and `WatchedCount`

**Files:**
- Create: `apps/raven/web/src/components/WatchedMark/WatchedMark.tsx`, `WatchedMark.module.scss`, `WatchedMark.test.tsx`
- Create: `apps/raven/web/src/components/WatchedCount/WatchedCount.tsx`, `WatchedCount.module.scss`, `WatchedCount.test.tsx`
- Modify: `apps/raven/web/src/pages/DesignPage/` (a sample of each, if the page lists shared components)

**Interfaces:**
- Produces:
  - `WatchedMark({ media, className? })`: renders `<span>` with the `check` icon, `aria-hidden`, plus `<span className="visually-hidden">Watched</span>`, only when `media.watched`; null otherwise.
  - `WatchedCount({ watched, total, className? })`: uses `watchedStateOf({ watched, total })`. `watched` state: the check and hidden "Watched". `partly`: the number `total - watched` and hidden `${n} unwatched episode(s)` (`plural` from `@/lib/plural`). `unwatched`: null.

- [ ] **Step 1: Write the failing tests**
  - `WatchedMark.test.tsx`: `shows a check with the words Watched for a watched video`; `shows nothing for an unwatched video`.
  - `WatchedCount.test.tsx`: `shows the check when everything is watched`; `shows the number left, with its words, when some is`; `says one unwatched episode in the singular`; `shows nothing when none is watched`; `shows nothing for an empty show`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/components/WatchedMark src/components/WatchedCount`
Expected: FAIL, the modules do not exist.
- [ ] **Step 3: Write the components and styles**
  - Both are small circular badges from the tokens (`--radius-*`, `--space-*`, a colour pair with 4.5:1 text on the poster); positioned by the container, so each takes a `className` and sets no position of its own.
  - A forced-colors border.
- [ ] **Step 4: Run them to see them pass**

---

### Task 2: The marks on every card

**Files:**
- Modify: `apps/raven/web/src/components/PosterCard/PosterCard.tsx` (+ `.module.scss`: the frame's named area), `MediaCard/MediaCard.tsx`, `MediaTiles/MediaTiles.tsx`, `MediaList/MediaList.tsx` (in the title cell, so the table header does not change), the episode row (`EpisodeRow`, wherever `SeasonPage.tsx` renders it)
- Modify: `ShowCard/ShowCard.tsx`, `ShowCard/ShowViews.tsx` (`ShowList`, `ShowTiles`), `pages/SeasonPage` or the show page's `SeasonCard`, `SagaDeck/SagaDeck.tsx`
- Test: the matching `*.test.tsx` of each

**Interfaces:**
- Consumes: `WatchedMark`, `WatchedCount`; `media.watched`, `ShowEntry.watchedEpisodes`/`episodes`, `SeasonSummary.watchedCount`/`episodeCount`, and for a saga `saga.media.filter((m) => m.watched).length` of `saga.media.length`.
- `PosterFrame` renders `WatchedMark` in the same grid area as `ResumeBar`, so a card in progress keeps its bar and a rewatch shows both.

- [ ] **Step 1: Write the failing tests**
  - Per card: `PosterCard shows the check for a watched video and not for another`; `PosterCard shows the check with the resume bar for a rewatch` (`watched: true`, `position: 30`); the same pair for `MediaCard`, `MediaTiles`, `MediaList` (the check in the title cell, the header unchanged), and the episode row.
  - `ShowCard`, `ShowList`, `ShowTiles`, `SeasonCard` and `SagaDeck`: `shows the number unwatched`, `shows the check when everything is watched`, `shows nothing when none is`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/components src/pages/SeasonPage src/pages/ShowPage`
- [ ] **Step 3: Add the marks and counts** to each card's markup and the container styles that place them.
- [ ] **Step 4: Run them to see them pass; check at 320px by eye** in `/design` and a library with every view.

---

### Task 3: Marking from the card's menu, and the caches

**Files:**
- Modify: `apps/raven/web/src/lib/edits.ts` (`watchedEdits`), `lib/invalidate.ts` (`afterWatched`, `afterWatching`), `lib/queryClient.ts` (`mutationKeys.watched`), `lib/useMediaMutations.ts` (`watched`)
- Modify: `apps/raven/web/src/components/MediaMenu/MediaMenu.tsx` (the item after Favourite)
- Test: `lib/edits.test.ts` (create beside it if absent; `favouriteEdits` is tested through `useMediaMutations.test.tsx` and `optimistic.test.tsx` today), `lib/invalidate.test.ts` (create), `lib/useMediaMutations.test.tsx`, `components/MediaMenu/MediaMenu.test.tsx`

**Interfaces:**
- `watchedEdits({ media, watched }): Edit[]`:
  - sets `watched` on every `MediaItem` of the same card (same `libraryId`, same `item?.id`, same `card`; a file with no item matches only itself) across what `favouriteEdits` covers, plus sagas (`sagasQuery`), duplicates, history entries' `media` and item `versions`;
  - sets `position` to 0 on those and removes the card's entries from In progress (`inProgressQuery`, home's `inProgress`);
  - each update returns the same reference where it changes nothing.
- `useMediaMutations({ media }).watched`: `useOptimisticMutation` with `mutationKey: mutationKeys.watched`, `mutationFn: (watched: boolean) => api.setWatched({ watched, targets: [{ kind: 'media', id: media.id }] })`, `edits: (watched) => watchedEdits({ media, watched })`, `settle: () => afterWatched(queryClient)`.
- `afterWatched(queryClient)`: invalidates `libraries`, `items`, `home`, `favourites`, `allMedia`.
- `afterWatching({ queryClient, libraryId })` adds `items` and `favourites`.
- `mutationKeys.watched = ['watched']`, so marks serialize.
- `MediaMenu`: "Mark as watched" when `!media.watched`, else "Mark as unwatched"; for viewers (not behind the admin lock).

- [ ] **Step 1: Write the failing tests**
  - `watchedEdits sets the flag on every file of the card, not on another card of the movie`;
  - `watchedEdits zeroes the position and drops the card from In progress`;
  - `watchedEdits covers sagas, duplicates, history and the item's versions`;
  - `watchedEdits hands back the same list where nothing changes`;
  - `afterWatched reads every library, items, home, favourites and media again`;
  - `afterWatching reads items and favourites too`;
  - `MediaMenu offers Mark as watched for an unwatched card and sends a media target`; `offers Mark as unwatched for a watched one`; `offers it with the admin lock on`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/lib src/components/MediaMenu`
- [ ] **Step 3: Write the code** as listed.
- [ ] **Step 4: Run them to see them pass**

---

### Task 4: The page toggles

**Files:**
- Modify: `apps/raven/web/src/components/PlayableItemView/PlayableItemView.tsx` (beside the favourite heart; movie and episode pages), `pages/ShowPage/ShowPage.tsx`, `pages/SeasonPage/SeasonPage.tsx`, `pages/SagaPage/SagaPage.tsx` (each beside Play), and each episode row on the season page
- Create: `apps/raven/web/src/lib/useWatchedChange.ts` (a `useMutation` for `item` targets and bulk marks: `mutationKey: mutationKeys.watched`, `mutationFn: api.setWatched`, `onSettled: afterWatched`)
- Test: `PlayableItemView.test.tsx`, `ShowPage.test.tsx`, `SeasonPage.test.tsx`, `SagaPage.test.tsx`, `lib/useWatchedChange.test.tsx`

**Interfaces:**
- The toggle: `Button tone="quiet" icon="check" aria-pressed={state === 'partly' ? 'mixed' : state === 'watched'}` named "Watched".
- Movie and episode pages: pressed = `primary.watched`; press sends `{ kind: 'media', id: primary.id }` through `useMediaMutations().watched` (pages are per library and card).
- Show page: state from `watchedStateOf({ watched: sum of season.watchedCount, total: sum of season.episodeCount })`; press when not `watched` marks everything watched, press when `watched` marks everything unwatched; targets `[{ kind: 'item', id: show.id, libraryId: null }]`.
- Season page: the same over its episodes (`child.watched`), `[{ kind: 'item', id: season.id, libraryId: null }]`; each episode row has its own toggle sending `{ kind: 'item', id: episode.id, libraryId: null }`.
- Saga page: state from its movies' `watched`; targets `saga.media.map((m) => ({ kind: 'item', id: m.item.id, libraryId: saga's library }))` (movies without an item send `media`).

- [ ] **Step 1: Write the failing tests**, one per page:
  - `PlayableItemView`: `shows Watched pressed for a watched movie and sends a media target when pressed`; the same on an episode page.
  - `ShowPage`: `reads as partly pressed when some episodes are watched`; `marks everything watched from a partly watched show, then everything unwatched` (asserting the two `setWatched` bodies).
  - `SeasonPage`: the same, plus `each episode row toggles its own episode`.
  - `SagaPage`: `sends the saga's movies`.
  - `useWatchedChange`: `keeps marks in order` (two presses resolve in order) and `refetches after the answer`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/components/PlayableItemView src/pages`
- [ ] **Step 3: Write the code** as listed, with the container styles that place the toggle beside Play (grid, no flex).
- [ ] **Step 4: Run them to see them pass**

---

### Task 5: History's note and the hints

**Files:**
- Modify: `apps/raven/web/src/lib/history.ts` (`howFar`, `historyNote`, `finishedNote`), `pages/LibraryPage/SectionViews.tsx` (Recently finished hint), `pages/HistoryPage/HistoryPage.tsx` (intro), `components/LibraryDialog/LibraryDialog.tsx` (the **Watched at** hint)
- Test: `lib/history.test.ts`, `pages/HistoryPage/HistoryPage.test.tsx`, `pages/LibraryPage/LibraryTabs.test.tsx`, `components/LibraryDialog/LibraryDialog.test.tsx`

**Interfaces:**
- `historyNote(entry)`: for `marked` the first part reads "Marked watched" in place of the percentage, and the time is the mark's; `plays` still reads "2 plays" only for real plays above one.
- `finishedNote` unchanged for real plays; a marked entry's day is its mark's.
- Copy, binding:
  - Recently finished empty: `Nothing finished in ${name} yet. A video counts once playback gets ${watchedPercent}% of the way through, or when you mark it watched.`
  - History intro: `Videos played or marked in ${name}, last played first. One counts as watched once playback gets ${watchedPercent}% of the way through, or when it is marked, which the library's settings can change.`
  - LibraryDialog hint: `A video counts as watched once playback gets this far through it, and its resume spot clears there too. Set low, a video gives up its spot early.`

- [ ] **Step 1: Write the failing tests**: `reads Marked watched for a mark`; `reads the percentage for a played video`; the three hints' new words.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/lib/history.test.ts src/pages/HistoryPage src/pages/LibraryPage src/components/LibraryDialog`
- [ ] **Step 3: Write the code.**
- [ ] **Step 4: Run them to see them pass**

---

### Task 6: README, the whole check and the commit

**Files:**
- Modify: `apps/raven/README.md` (the card menu paragraph under "Favourites and deleting": **Mark as watched** and **Mark as unwatched** after **Favourite**, for viewers with the admin lock on too; the watched marks on cards and pages; the page toggles)

- [ ] **Step 1: Update the README.**
- [ ] **Step 2: Run everything**

Run: `bunx nx run @raven/web:test`, `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts`, `bunx nx run @raven/web:lint:css`, `bunx nx run @raven/web:format`, `bun run verify`.
Expected: all PASS, coverage above the floors.
- [ ] **Step 3: Look at it**: run the app (`run` skill), mark a movie, a season and a show, reload, check 320px and the forced-colors border; add screenshots to the PR per `pr-format`.
- [ ] **Step 4: Commit**

```bash
git add apps docs
git commit -F - <<'MSG'
MAE: raven shows what is watched and marks it from cards and pages

- `WatchedMark` and `WatchedCount` on every card
- Mark as watched in the card menu, `Watched` toggles on pages and episode rows
- History says "Marked watched"; the hints state the new rule
MSG
```
