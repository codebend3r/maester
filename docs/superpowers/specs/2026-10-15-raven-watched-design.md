# raven watched

raven works out whether a video is watched from its plays: a play past the library's **Watched at** percentage counts, and nothing else does. There is no way to say "I saw this elsewhere" or "I never finished that", nothing shows on a card whether it is watched, and a whole show or saga can only be marked by playing every file. This lets a viewer mark any video, or anything holding videos (a season, a show, a saga, a selection), watched or unwatched, shows the watched state on every card and page, and adds a select mode for marking many at once. It also makes **Watched at** the one threshold: the point where a play counts as watched is the point where its resume spot clears.

Decided with the user:

- Video now: files, movies (each card, split ones included), sagas, shows, seasons and episodes. Albums, tracks and playlists have no code to build on yet; the design resolves everything to cards and files so they join without changing the rule or the API (see "Music and playlists").
- Marking watched records a play, so it shows in History and Recently finished.
- Marking unwatched is a clean slate: the plays marks wrote go, real plays stay in History but stop counting, and only plays after it count.
- One threshold: **Watched at**, 95% by default, counts a play as watched and clears its resume spot. Libraries still at the old default, 90, move to 95.
- Select mode starts from a Select button; shift-click selects a range; a bar at the bottom marks the selection.

## What the viewer sees

- A watched video's card carries a check in its poster corner: posters, media cards, tiles, list rows and episode rows. A card in progress keeps its resume bar; one watched and then started again (a rewatch) shows both.
- A show, season or saga card shows a check when everything in it is watched, and the number left unwatched when some of it is ("6"), nothing when none is.
- Every card's menu has **Mark as watched** or **Mark as unwatched**, by its state. It is for viewers, not behind the admin lock.
- The movie and episode pages have a **Watched** toggle beside the favourite heart. The show, season and saga pages have one beside Play, which reads as partly pressed when some of what they hold is watched: pressing it marks everything watched, and pressing it again marks everything unwatched.
- Each episode row on a season page has its own **Watched** toggle.
- History notes a marked video as "Marked watched". Its plays count only real plays.
- **Select** sits in the library toolbar, in a small header on each other tab (In progress, Favourites, Recently finished, Sagas), and beside Play on the saga, show and season pages. In select mode every card shows a checkbox.
- In select mode a click on a card selects or deselects it instead of opening it, and shift-click selects every card between the last one clicked and this one, in the order they show. A bar at the bottom says how many are selected and offers **Select all**, **Mark watched**, **Mark unwatched**, **Clear** and **Done**. After marking, the selection stays and the bar says "Marked 12 watched", so the other button reverses it.
- Leaving the page or tab, **Done**, or Escape ends select mode.

## The rule

A **card** is what a listing shows as one entry, in one library:

- a movie's files that share its card (all of them, or those of one cut once split apart, `media.split`)
- an episode's files
- a file matched to nothing, on its own

A file is watched when it has a `marked` play, or when its duration is known and a `played` play got to at least `duration × watched_percent / 100`. A card is watched when any of its files is. An episode is watched when any of its files the viewer may see is, so a file holding two episodes watches both, and unwatching either unwatches both.

**Plays get a kind.** `plays.kind` is `played` (a real play, which counts), `marked` (written by Mark as watched, which always counts) or `cleared` (a real play that Mark as unwatched set aside, which stays in History and never counts). `notePlay` continues only a `played` play within its sitting, so playing again after unwatching starts a new play.

**Mark as watched**, for each card that is not watched:
- One `marked` play on the card's best file (`BEST_FIRST`), dated now, with `furthest` set to its duration, or 0 while unprobed.
- Every resume spot on the card is deleted. That holds even in a library that saves no progress: marking is explicit, unlike `report()`, which leaves such a library's spots alone.
- Cards already watched, including one an earlier card in the same request just made watched through a two-episode file, are left alone. A three-version movie gets one History row, not three.

**Mark as unwatched**, for each card that is watched, on every file of the card:
- Its `marked` plays are deleted.
- Its `played` plays become `cleared`.
- Its resume spots are deleted.

Cards already unwatched are left alone, so marking a partly watched season unwatched does not set aside the plays of episodes in progress.

**One threshold.** `report()` clears the resume spot when the position reaches the library's **Watched at** (`duration × watched_percent / 100`), replacing the hardcoded 95%. The rule for the first few seconds is unchanged. So a play that counts as watched never also leaves a spot.

Consequences:
- A library set low gives up its spot early (at 50%, halfway); the Edit library hint says so.
- After the migration, files last stopped between 90% and 95% are no longer watched and keep the spot they already had: they are in progress, as they look.

## Music and playlists

Nothing is built for them now; this is how they join.

- Albums and tracks become item types, an album holding its tracks as a season holds episodes, and a track's file is a card. `{ kind: 'item' }` targets, the counts and the rule cover them unchanged.
- A playlist adds `{ kind: 'playlist', id }` to `isWatchTarget`, resolving to its entries' cards. The server's resolution is an exhaustive `switch` on `kind`, so the compiler names every place a new kind must be handled.
- An audio library's copy may say "played" where video says "watched"; that is a copy choice for that spec.

## API

In `libs/raven/core/src/contract.ts`:

- `isMediaItem` gains `watched: isBoolean`: whether its card is watched.
- `isEpisodeSummary` gains `watched: isBoolean`: any of its files the viewer may see is watched. It is not read off `primary`, whose card for a two-episode file is the first episode's.
- `isSeasonSummary` gains `watchedCount: isNumber`, of its `episodeCount`.
- `isShowEntry` gains `watchedEpisodes: isNumber`, of its `episodes`.
- `isHistoryEntry` gains `marked: isBoolean` (a mark holds it watched). `plays` counts real plays only, and `furthest` comes from `played` plays only, so a cleared full play does not read "100% watched" next to an unwatched film.
- `isWatchTarget = union(object({ kind: oneOf(['media']), id: isNumber }), object({ kind: oneOf(['item']), id: isNumber, libraryId: nullable(isNumber) }))`.
  - `kind` matches `isMatchSubject`.
  - A `media` target is the card that file is on.
  - An `item` target is every card under the item (a show, season, episode or movie) in `libraryId`, or in every library the viewer may see when it is null.
  - A saga is the item targets of its movies in its library; the client already holds them in `Saga.media`.
- `isWatchedChange = object({ watched: isBoolean, targets: listOf(isWatchTarget) })`.

`libs/raven/core/src/watched.ts`:
- `isWatchedState = oneOf(['unwatched', 'partly', 'watched'])`.
- `watchedStateOf({ watched, total })`. The cards' count badge and the page toggles' `aria-pressed` (`mixed` for `partly`) read it.

`DEFAULT_LIBRARY_SETTINGS.watchedPercent` becomes 95. `isWatchedPercent` keeps 1 to 100.

`api.setWatched({ watched, targets })` sends `PUT /api/watched`.

`PUT /api/watched`:
- `@ForViewers()`, 204.
- The body is checked with `isWatchedChange` through `parseBody`. An empty `targets`, or more than 5000, is a 400.
- The route takes no `:id`, so it carries no lock mark and hides what the browser may not see itself. Targets in libraries `viewer.seesLibrary` refuses, or naming nothing, are skipped without error, so the answer never tells a hidden library is there.
- All of it runs in one transaction.

## Server

- **Migration 25**, appended to `MIGRATIONS` in `apps/raven/server/src/db/database.ts`:
  - `ALTER TABLE plays ADD COLUMN kind TEXT NOT NULL DEFAULT 'played' CHECK (kind IN ('played', 'marked', 'cleared'))`. The bundled SQLite, 3.53, accepts a CHECK on an added column.
  - `UPDATE libraries SET watched_percent = 95 WHERE watched_percent = 90`.
  - Deleting every `playback_progress` row whose position is at or past its library's threshold.
  - No new index: `plays_media (media_id, played_at)` serves the lookups.
- **`apps/raven/server/src/media/mediaSql.ts`:**
  - `fileWatched(file)` replaces `FURTHEST_JOIN` and `isWatched`. It is an `EXISTS` over the file's plays: a `marked` one, or a `played` one at the threshold. That avoids aggregating the whole `plays` table.
  - `cardWatched` widens it to the card: the other files in the library with the same movie and `split` (as `versions` counts), or the same episode.
- **`MediaRepository`** (`apps/raven/server/src/media/mediaRepository.ts`):
  - `SELECT_COLUMNS` gains `watched` beside `versions`, so every `MediaItem` carries it: listings, `getMany`, in progress, favourites, sagas, unmatched, home.
  - `listShows` adds a per-file watched flag to `EPISODE_FILES` and counts `DISTINCT` watched episodes.
  - `nextUnwatched` works at the episode level, skipping an episode with any watched file. Today it filters files, so a watched 1080p and an unwatched 720p of one episode return the 720p. It uses a window (`MAX(watched) OVER (PARTITION BY episode)`), not a self-join.
  - New `watchedEpisodes(ids)` answers `(episode_id, library_id)` for the watched ones.
- **`itemChildren.ts`:** `watchedCount` and `EpisodeSummary.watched` come from `watchedEpisodes`, counting only libraries the viewer sees.
- **`GET /api/items/:id/next`:** scoped to the libraries the viewer sees, rather than answering null when the first pick is in a locked library.
- **`ViewingRepository`** (`apps/raven/server/src/media/viewingRepository.ts`):
  - `report()` clears at the library's threshold.
  - `notePlay` continues only `played` plays.
  - `history()` counts real plays, takes `furthest` from `played`, and adds `marked`. `watched` and the Watched filter follow the rule.
- **`WatchedCards`** (`apps/raven/server/src/media/watchedCards.ts`): resolves targets to cards in visible libraries, each with its files and best file. `item` targets go through `MetadataRepository.mediaUnder`.
- **`WatchedRepository`** (`apps/raven/server/src/media/watchedRepository.ts`): `set({ cards, watched, at })` applies the rule card by card, re-reading each card's state as it goes.
- **`WatchedController`** (`apps/raven/server/src/media/watchedController.ts`), registered in the app module.

## Web

`@raven/ui` does not exist yet; the desktop's first release moves only the player, so all of this lives in `apps/raven/web/src`.

**Marks and toggles:**
- `WatchedMark` (`components/WatchedMark`), a check badge with hidden "Watched", sits in the poster frame's grid area beside `ResumeBar`. It goes on `PosterCard`, `MediaCard`, `MediaTiles`, `MediaList` (in the title cell, so the table header does not change) and `EpisodeRow`. History tiles leave it off; their note already says.
- `WatchedCount`, the check or the unwatched number with hidden "6 unwatched episodes", goes on `ShowCard`, `ShowList`, `ShowTiles`, `SeasonCard` and `SagaDeck`.
- Colours and sizes come from the tokens in `globals.scss`; it gets a new token only if none fits.
- **Watched** toggles are `Button tone="quiet" icon="check"` with `aria-pressed`, beside the favourite in `PlayableItemView` and beside Play on the show, season and saga pages. Each page's toggle derives its state with `watchedStateOf`. The movie and episode pages send a `media` target (pages are per library and card). The show and season pages send `item` targets with a null library; the saga page sends its movies.
- `MediaMenu` gains **Mark as watched** or **Mark as unwatched** after Favourite. `useMediaMutations` gains `watched`.
- The history note reads "Marked watched" for `marked`. The hints that state the old rule are updated: Recently finished (`SectionViews.tsx`), History (`HistoryPage.tsx`) and the **Watched at** hint in `LibraryDialog.tsx`.

**Caches:**
- A `media` target is optimistic. `watchedEdits` in `lib/edits.ts` sets `watched` on every `MediaItem` of the same card (same library, item and `card`) across what `favouriteEdits` covers, plus sagas, duplicates, history and item versions. It also sets `position` to 0 and drops the card from In progress.
- `item` targets and every bulk mark wait for the answer; counts and `next` cannot be patched safely.
- Both settle with `afterWatched` in `lib/invalidate.ts`: every library, `items`, `home`, `favourites` and `media`.
- `afterWatching` also invalidates `items` and `favourites`, so a season page shows an episode watched after playing it.
- `mutationKeys.watched` serializes the marks.

**Select mode:**
- **The store.** `stores/selection.ts` exports `createSelectionStore()`, a vanilla zustand store: `{ selecting, keys, anchor, start, toggle, range, selectAll, clear, end }`.
  - `SelectionScope` puts one in context per section or page, given `resolve(key) => WatchTarget[]` and `allKeys()` from the section's data.
  - A section's own remount (`LibraryPage` keys sections by tab) ends select mode with it.
  - Cards subscribe to `s.keys.has(key)`, so a toggle redraws one card.
- **Entry keys.** Cards carry `data-entry` keys from `lib/entryKeys.ts`, which gains keys for seasons, episodes and sagas.
- **Ranges.** Shift-click ranges go by DOM order, using `useScrollReset.ts`'s selector (`[data-entry]:not(details:not([open]) *)`). `MediaList` sorts on the client and `MediaGroups` closes its buckets, so data order would be wrong. **Select all** takes `allKeys()`, closed buckets included.
- **Clicks.** `useSelectable(key)` gives a card its checkbox props and an `onClickCapture` on the card root that prevents the click and toggles in select mode. `CardLink` and react-router's `Link` already leave a prevented click alone, so neither changes, and shift-click no longer opens a window.
- **The checkbox** is an `<input type="checkbox">` labelled "Select {title}", inside the card box: `content-visibility: auto` clips anything outside it.
  - Outside select mode it is not shown, and has `tabIndex={-1}`, so thousands of cards add no tab stops.
  - In select mode it shows on every card and is the card's only tab stop: links take `tabIndex={-1}`, and the play overlay and menu trigger hide.
- **`SelectionBar`** (`components/SelectionBar`):
  - A `section` labelled "Selection", sticky at the bottom of the main column. It is laid out as a grid that wraps to two rows below `30rem` and fits 320px.
  - It holds a polite `<output>` with the count and the outcome, then **Select all**, **Mark watched**, **Mark unwatched** (both disabled with nothing selected), **Clear** and **Done**.
  - A failed mark shows `role="alert"` text and keeps the selection.
  - Escape (through `useKeyShortcut`, so an open menu or dialog takes it first) and Done end select mode and return focus to Select (`useReturnFocus`).
  - Its slide-in is inside `@media (prefers-reduced-motion: no-preference)`.
- **Where it runs.** Every view of All (`MediaGrid`, `MediaList`, `MediaTiles`, `MediaGroups`, `ShowGrid`, `ShowList`, `ShowTiles`), In progress and Favourites (`EntryGrid`), Recently finished (`MediaTiles`), Sagas (`SagaDecks`), the saga page's grid, the show page's season cards and the season page's episode rows.
- **Selected kinds.** A selected file sends a `media` target, a show or season card an `item` target (with its library on library pages, null on the show page), an episode row an `item` target with a null library, and a saga its movies. Kinds mix freely in one request.

## Accessibility

- The check is never the only signal: `WatchedMark` and `WatchedCount` carry hidden text, and toggles use `aria-pressed` (`mixed` when partly).
- Select mode keeps one tab stop per card, labelled with its title. The bar's count and outcome are announced politely, and Escape leaves, returning focus to Select.
- Every control has a visible `:focus-visible` from `--focus-ring`.
- Works at 320px; the bar wraps.

## Testing

**Core:**
- `isWatchTarget` with both kinds and a missing `libraryId`.
- `isWatchedChange`.
- `watchedStateOf` at none, some and all, including an empty total.
- The new fields on `isMediaItem`, `isEpisodeSummary`, `isSeasonSummary`, `isShowEntry` and `isHistoryEntry`.
- `setWatched` sending its body.
- Both fixture files gain the fields.

**Server:**
- **The migration** (`database.test.ts`): existing plays become `played`, 90 moves to 95 and 80 stays, and spots past the threshold go.
- **`ViewingRepository`:** `report` clears at the library's threshold and not before, and a library with progress saving off keeps its spots; `notePlay` never continues a `marked` or `cleared` play; `history` counts real plays, takes `furthest` from `played`, and reports `marked`, with the Watched filter following the rule.
- **`WatchedRepository`:**
  - One mark per card, on the best file, with resume spots cleared on every file of the card.
  - A watched card left alone.
  - A two-episode file marked once for both episodes.
  - Unwatching deletes marks, clears plays and spots, and leaves unwatched cards in progress alone.
  - A later play counts again.
  - An unprobed file can be marked.
  - Split cards are marked apart.
- **`MediaRepository`:** card-level `watched` in `list`, `getMany`, `listSagas` and in progress; `listShows` counts with a two-episode file; `nextUnwatched` skipping an episode watched in any of its files.
- **Others:**
  - `itemChildren` counts only visible libraries.
  - `listingPlans.test.ts` asserts the watched lookup searches `plays_media`, and `queryPlans.test.ts` keeps passing.
- **`appWatched.test.ts`**, end to end through `apiFor`:
  - Each target kind.
  - A locked library's targets skipped.
  - An empty body and 5001 targets are 400s.
  - Another write route still refuses a missing `@ForViewers()`.
  - The 204.
- **`app.test.ts`:** the default of 95.

**Web:**
- `WatchedMark` and `WatchedCount` per state.
- The menu item, and the toggles on the movie, episode, show, season and saga pages and episode rows, sending the right targets.
- `watchedEdits` covering every cache and returning the same reference when nothing changes.
- `afterWatched` and `afterWatching` invalidations.
- The "Marked watched" note.
- **Select mode:** the Select button starts it; a click toggles and does not navigate; shift-click selects a DOM-order range in a client-sorted list; Select all includes closed buckets; the bar's count, outcome, failure and Done; Escape and focus return; tab order in select mode.
- Coverage stays above the floors in `apps/raven/web/package.json`.

## Docs

- **`apps/raven/README.md`:**
  - The resume line (the library's Watched at, not "the last 5%").
  - **Watched at** (95%, and it clears the resume spot).
  - Recently finished and History (marks, cleared plays).
  - The card menu.
  - A short "Marking watched" section on select mode.
- **`docs/superpowers/specs/2026-10-12-raven-desktop-design.md:460`:** server titles clear their spot at the library's Watched at.

## Order of work

Three stacked PRs, each built by subagents (an implementer and a reviewer per task):

1. **The rule** (branch `raven-watched-server`): this spec and the plans, migration 25, the SQL fragments, `watched` and the counts everywhere, `nextUnwatched`, the threshold in `report()`, history, `PUT /api/watched`, the contract, `watched.ts`, `setWatched`, the fixtures and the README. The web compiles with the new fields and looks as it does today.
2. **Marks and toggles** (branch `raven-watched-web`, on step 1): `WatchedMark`, `WatchedCount`, the menu item, the page and row toggles, the history note and hints, `watchedEdits`, `afterWatched` and `afterWatching`.
3. **Select mode** (branch `raven-watched-select`, on step 2): the selection store and scope, `useSelectable`, the checkbox, `SelectionBar`, the Select buttons and the entry keys, on every section and page listed.

## Out of scope

- Watched state per person: raven has no accounts until rookery signs viewers in.
- Music libraries, albums, tracks and playlists, beyond the shape above.
- Select mode on Home, the History page, people pages and search results.
- Long-press to select on touch; Select is the way in there.
- Undo beyond pressing the other button, and confirming a bulk unmark.
- Keyboard shortcuts for marking.
- Importing watched state from Plex.
- Hiding unwatched episodes' stills.
