# raven account data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each raven account gets its own progress, plays, watched marks and favourites. Everything recorded before this ships moves to the owner, and a server without accounts keeps one shared viewer, exactly as today.

**Architecture:** The four per-viewer tables gain an `account_id` column holding the Supabase user UUID. Existing rows migrate to the sentinel `'local'`, because SQL migrations cannot know the owner's UUID. Each request resolves one account key from the caller that enforcement already resolves. The approved owner's first request under `ready` adopts every `'local'` row in one idempotent transaction and records the owner's UUID, which servers without accounts then use as their shared key. Every repository read and write binds the key as `@account`. No contract, API path or response shape changes; the server answers the same routes per account.

**Tech Stack:** NestJS 12 on Fastify, better-sqlite3 13.0.3 (SQLite 3.53.4), `openSqlite`'s `user_version` runner from `@shared/server`, vitest; `@raven/desktop` main and renderer (bun test); `@raven/web` (bun test + happy-dom).

**Spec:** `docs/superpowers/specs/2026-10-17-supabase-sign-in-design.md`: step 7 of "Implementation order" and the "Viewing data" row of "Scope decisions". Parent plan: `docs/superpowers/plans/2026-10-17-supabase-sign-in.md` (the `raven-account-data` row). Enforcement plan, whose seams this plan consumes: `docs/superpowers/plans/2026-10-18-raven-auth-enforcement.md`. Branch `raven-account-data`, **stacked on `raven-auth-enforcement`** (which is on `raven-auth-desktop`, on `raven-auth-ui` #247). Rebase onto it once its Tasks 1 to 4 have landed; no task here starts before.

## Per-viewer data inventory

Everything the server keeps or derives per viewer today, and what this plan does with it.

| Data | Where | Read by | This plan |
|---|---|---|---|
| Resume spot | `playback_progress` (PK `media_id`); written by `ViewingRepository.report`, cleared by `WatchedRepository.set` | `MediaRepository` `SELECT_COLUMNS`/`FROM_MEDIA` (`position` on every `MediaItem`), `listInProgress` (Home's Continue watching, a library's In progress) | Per account |
| Plays and history | `plays` (`kind` `played`/`marked`/`cleared`); `ViewingRepository.notePlay`, `recordPlay`, `report`, `history`; `WatchedRepository.set` | `fileWatched` and `cardWatched` in `mediaSql.ts`, so `watched` on every `MediaItem`, `listShows` (`watchedEpisodes`), `nextUnwatched` (`nextEpisode`, show Up next), `watchedEpisodes` (`itemChildren`: season and episode watched counts), `GET /api/libraries/:id/history` | Per account |
| Watched marks | `plays` rows of kind `marked`/`cleared` (`PUT /api/watched`) | as above | Per account |
| Video favourites | `favourites` (PK `media_id`); `ViewingRepository.setFavourite` | `favourite` on every `MediaItem`, `listFavourites` (`GET /api/favourites`, `GET /api/libraries/:id/favourites`) | Per account |
| Show and season favourites | `item_favourites` (PK `item_id`); `TitleFavourites` | `ItemDetails.favourite`, `GET /api/favourites/titles` | Per account |
| PIN unlock | `raven_unlock` cookie | lock guard | Already bound to the account (enforcement Task 4) |
| Library view: sort, view, grouping, pinned | `libraries` columns, `PUT /api/libraries/:id/view` (`@ForViewers`) | every listing | **Stays shared** (spec step 9, "optional per-account library preferences") |
| Save progress, watched percentage | `libraries` columns, owner-only | resume and watched rules | Stays shared: a library's rule for every account |
| Playback and display settings | `settings` rows, owner-only | every viewer | Stays shared |
| Open streams | `StreamSessions`, in memory | owner's Streams page | Unchanged (per client, not stored) |
| SSE | `ServerEvents`: one event, `{ type: 'library', libraryId }` | web invalidation | Unchanged: library changes are shared data. No viewing event exists |
| Browser prefs | web `localStorage`: theme, side menu, `playerPrefs`, `mediaOrigin` | the browser | Unchanged: per browser, not per account |
| Desktop server recents | `playerState.recents` entries of kind `server` (title and watched share) | Home | Cleared when that server's account changes (Task 4) |
| Desktop offline plays of downloads | `downloadState` `pending` and `owed`, sent by `downloads/sync.ts` as `saveProgress`/`recordPlay` | the server | Tagged with the account that made them (Task 4) |
| Desktop cached server data | renderer queries under `['desktop', 'server', serverId, ...]` (`MediaItem.position` for resume) | `ServerPage` | Reset on that server's `account` event (Task 4) |
| Desktop local resume, track picks, local recents | `playerState` | local files | Unchanged: per Mac |
| Web cached queries | TanStack Query | every page | Already reset on sign out and account switch (`clearAccountState`, #247); Task 5 proves it for viewing data |

Routes whose answers change per account (all already approved-only under `ready`): every route returning a `MediaItem`, `ShowEntry`, `HistoryEntry`, `PosterEntry`, `Saga` or `ItemDetails` (`/api/libraries/:id/{media,shows,history,in-progress,favourites,sagas,unmatched,duplicates}`, `/api/media/:id`, `/api/items/:id`, `.../next`, `.../random`, `/api/home`, `/api/home/search`, `/api/favourites`, `/api/favourites/titles`, `/api/streams`; `/api/people/:id` embeds no viewing data), and the writes `PUT /api/media/:id/progress`, `POST /api/media/:id/plays`, `PUT /api/media/:id/favourite`, `PUT /api/items/:id/favourite`, `PUT /api/watched`.

## Decisions

Settled here from the spec and the enforcement decisions (D1 to D5). "Questions for the user" lists the only open ones.

- **A1, the account key is the Supabase user UUID** (`Account.id`, the JWT `sub`), never the email. Column `account_id TEXT NOT NULL` on all four tables. In code it is `type AccountKey = Account['id'] | typeof VIEWING_ACCOUNTS.local`.
- **A2, servers without accounts keep one shared viewer.** Under auth `off`, the `legacy` caller's key is the adopted owner's UUID once one is recorded, else `VIEWING_ACCOUNTS.local = 'local'`. A server never set up for Supabase keeps reading and writing `'local'` forever: no visible change. A server rolled back with `RAVEN_ACCOUNTS=off` (D1) shows the owner's history to its anonymous viewers, as before this step, and writes there; returning to `ready` finds it intact.
- **A3, the migration needs no runtime input.** The account migration (the next `MIGRATIONS` entry) rebuilds `playback_progress`, `favourites` and `item_favourites` as `WITHOUT ROWID` tables with `PRIMARY KEY (account_id, ...)` and copies their rows under `'local'`, with an index on each media or item reference so `ON DELETE CASCADE` does not scan (built: the plain rowid tables planned a scan of `f` and `p`). It adds `plays.account_id` with `DEFAULT 'local'` (an O(1) `ALTER` in SQLite) and the index `plays_account (account_id, media_id, played_at)`. `plays_media` stays for `ON DELETE CASCADE` from `media`. The plays `kind` CHECK survives (spike).
- **A4, the owner adopts at runtime, idempotently.** Under `ready`, the first request whose caller is an approved account with `isOwner` (authoritative, from `current_membership`) runs one transaction. It merges every `'local'` row into the owner's: the newer spot wins, the earlier favourite time wins, and plays move as they are. It deletes the `'local'` rows and writes the settings key `viewing` as `{ ownerId, adoptedAt }`. A second run finds no `'local'` row and changes nothing; a crash mid-way rolls the whole transaction back. Until the owner's first request, members see only their own (empty) data and nobody sees `'local'`. The `isOwner` flag is never taken from a client or a JWT claim.
- **A5, removing an account keeps its rows.** In raven's model, removal is reversible (Users screen, Removed tab, Approve), so an account that is approved again finds its history. Nothing exposes one account's rows to another, a revoked account cannot reach them, and they are a few rows per title. Deleting an account's viewing data is a later owner tool, not part of this step.
- **A6, SSE is unchanged.** It carries only `library` events, which are shared library data, and nothing in this step adds a viewing event. Global Constraints forbid adding one unless it goes only to its own account's streams.
- **A7, caching.** Every per-account response is already `cache-control: no-store` with `Vary: authorization, cookie` under `ready` (enforcement Task 2). `@fastify/compress` 9.2.2 appends `accept-encoding` to an existing `Vary` (`setVaryHeader`). Task 4 asserts both on each per-account route, compressed. No handler that embeds a `MediaItem` may set its own cache policy. Images, files, subtitles and tracks carry no per-account data and keep their `private` policies.
- **A8, the desktop keeps per-Mac data per Mac.** Server recents and cached server queries are cleared when that server's account changes. A download's offline plays are tagged with the account signed in when they happened and sent only under that account. A play made while signed out of that server is not queued; the Mac's local resume still records it.
- **A9, the shared past goes to the owner.** Everything recorded before this ships moves to the owner, as the spec says, including what approved members played while viewing data was still shared after enforcement. raven cannot attribute those rows. The operator note in Task 8 says so.

## Questions for the user

Only these are open; the tasks are written for the recommendation.

1. **Library view settings stay shared** (see the inventory). Under enforcement, any approved member can change a library's sort, view, grouping or Home pin for everyone through `PUT /api/libraries/:id/view`. Recommendation: leave it for spec step 9 (per-account library preferences). Alternative: make the route owner-only now (one mark change and an inventory row in enforcement's route test), so members can no longer rearrange the owner's libraries.
2. **Offline plays made while signed out of a server** (A8). Recommendation: not sent to the server, so they can never land in the wrong account. Alternative: queue them untagged and send them under the next account to sign in on that server.

## Global Constraints

- Every read or write of `playback_progress`, `plays`, `favourites` or `item_favourites` binds the caller's key as `@account`. A statement over those tables with no `account_id` condition is a bug; the only exceptions are the account migration, the adoption transaction and `ON DELETE CASCADE`.
- Keys come from `ViewingAccounts.keyOf({ request })` only, never from a body, query, header or claim. `'local'` is never a valid Supabase UUID, so the two can never collide.
- No contract change in `@raven/core`, no new route, no response shape change. Core stays platform-agnostic.
- Per-account responses are never `public`, never cached across accounts: `no-store` and `Vary: authorization, cookie` (A7). No viewing event on SSE unless it is filtered to its own account.
- Server rules (`apps/raven/CLAUDE.md`): append migrations, never edit a shipped one; explicit `@Inject(Token)`; `assertRoutesMarked` unchanged (no new routes).
- Repo rules (root `CLAUDE.md`): no casts, `any`, enums, `interface`, non-null `!` outside tests, or loops; `type` aliases; named exports; `@/` imports without extensions; identifier strings (`VIEWING_ACCOUNTS.local`, the settings key, store kinds) are `as const` values declared once; one object parameter (positional repository signatures such as `get(id)` become `get({ id, account })`); discriminated unions switched exhaustively with a `never` default; early returns; no comments that restate code; no em or en dashes, UI copy and log lines included.
- No account id, email or token in a log line. The adoption log line gives counts only.
- Desktop: main-process modules take Electron as parameters; the renderer never sees an account id; the download store's version bumps with an upgrade. Exact dependency versions (none are added).
- Tasks run through Nx from the worktree root: `bunx nx run @raven/server:test` (or `:typecheck`, `:lint:ts`, `:format:check`), the same for `@raven/desktop` and `@raven/web`, then `bun run verify`.

## Review Focus

- A listing query that forgets `@account` on one of its joins: with two accounts, B sees A's `position`, `favourite` or `watched` (Task 2's isolation suite reads every per-account route as both).
- `fileWatched` inside `cardWatched`, `nextUnwatched`, `watchedEpisodes` and `listShows`: each binds `@account`, and each plan in `queryPlans`/`listingPlans` still searches `plays` by index, never scans it (Task 1).
- Adoption run twice, run with a conflicting owner row, and run after a rollback that wrote under the owner: no duplicates, the newer spot wins, nothing lost (Task 3).
- A member's request before the owner's first one: it sees nothing of the owner's past, and the `'local'` rows survive for the owner (Task 3).
- `RAVEN_ACCOUNTS=off` after adoption: anonymous viewers read and write the owner's rows, never a fresh `'local'` set (Task 3).
- Desktop: A watches a download offline, signs out, B signs in on the same Mac. A's play never reaches B's history, and B's Home has no A recents (Task 4).

---

### Task 0: Spike, no repo code

**Files:** scratchpad only (`account-data-spike/spike.ts`).

- [x] **Step 1:** better-sqlite3 13.0.3 binds positional and named parameters together: `prepare('SELECT ? AS a, @account AS v, ? AS b').get(1, 2, { account: 'x' })` answers `{ a: 1, v: 'x', b: 2 }`, and the named object may come first. So existing `?` statements gain `@account` without rewriting their parameters.
- [x] **Step 2:** The account migration's SQL (Task 1), run as `openSqlite` runs one (`db.exec` inside `db.transaction`, `foreign_keys = ON`), copied every row under `'local'`. `foreign_key_check` is empty, the plays `kind` CHECK still rejects `'bogus'`, and deleting a media row still cascades to the rebuilt `playback_progress`.
- [x] **Step 3:** Plans with production-like `sqlite_stat1`: the listing's `LEFT JOIN`s are `SEARCH p USING PRIMARY KEY (account_id=? AND media_id=?)` (same for `f`), and `fileWatched`'s correlated subquery is `SEARCH pl USING INDEX plays_account_media (account_id=? AND media_id=?)` (the spike's name for Task 1's `plays_account`). Continue watching is `SEARCH p USING PRIMARY KEY (account_id=?)`. With only the test's own two rows analyzed, SQLite scans `plays`, which is why Task 1 updates `PRODUCTION_STATISTICS` before reading plans.
- [x] **Step 4:** The adoption merge (`INSERT ... SELECT ... ON CONFLICT DO UPDATE ... WHERE excluded.updated_at > playback_progress.updated_at`, then `DELETE ... WHERE account_id = 'local'`) moved 2 plays the first time and 0 the second; the owner's newer spot (70 s, 2026-10-05) beat the older `'local'` one, and the earlier favourite time was kept.
- [x] **Step 5:** `@fastify/compress` 9.2.2's `setVaryHeader` appends `accept-encoding` to an existing `Vary` rather than replacing it.
- **Not run:** a real Supabase stack (the owner's `isOwner` comes from the #239 fixture in tests; Task 6's walkthrough uses the local stack) and a copy of Vhagar's database (Task 6, step 3 times the migration on a copy).

### Task 1: Viewing rows keyed by account

One task and one commit, because the schema, the repositories and their callers cannot be green apart: the rebuilt tables have no default `account_id`, on purpose, so a write that forgets the key fails instead of landing in `'local'`.

**Files:**
- Create: `apps/raven/server/src/media/viewingAccounts.ts`, `viewingAccounts.test.ts`
- Modify: `apps/raven/server/src/db/database.ts`, `database.test.ts`; `apps/raven/server/src/media/mediaSql.ts`, `mediaRepository.ts`, `viewingRepository.ts`, `watchedRepository.ts`, `titleFavourites.ts`, `movieSplits.ts`; `apps/raven/server/src/items/itemChildren.ts`; the controllers `media/mediaController.ts`, `media/homeController.ts`, `media/favouritesController.ts`, `media/watchedController.ts`, `libraries/librariesController.ts`, `items/itemsController.ts`, `items/matchController.ts`, `streams/streamsController.ts`; `apps/raven/server/src/appModule.ts`; `apps/raven/server/src/test/queryPlans.ts`, `test/repositories.ts`; the tests `media/viewingRepository.test.ts`, `media/watchedRepository.test.ts`, `media/titleFavourites.test.ts`, `media/listingPlans.test.ts`, `metadata/shows.test.ts`, `test/queryPlans.test.ts`

**Interfaces:**
- Produces: `VIEWING_ACCOUNTS = { local: 'local' } as const` and `type AccountKey = Account['id'] | typeof VIEWING_ACCOUNTS.local`.
- The account migration, appended to `MIGRATIONS` as its next entry, with a comment saying why (rows belong to an account, and the owner adopts `'local'` at runtime because a migration cannot know the owner):
  ```sql
  CREATE TABLE progress_by_account (
    account_id TEXT NOT NULL,
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    position REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, media_id)
  );
  INSERT INTO progress_by_account SELECT '${VIEWING_ACCOUNTS.local}', media_id, position, updated_at FROM playback_progress;
  DROP TABLE playback_progress;
  ALTER TABLE progress_by_account RENAME TO playback_progress;
  ```
  Built `WITHOUT ROWID` with cascade indexes (see A3). The same for `favourites` (`account_id, media_id, added_at`) and `item_favourites` (`account_id, item_id, added_at`, `REFERENCES items (id) ON DELETE CASCADE`). Then `ALTER TABLE plays ADD COLUMN account_id TEXT NOT NULL DEFAULT '${VIEWING_ACCOUNTS.local}'; CREATE INDEX plays_account ON plays (account_id, media_id, played_at);`. The plays default only fills the existing rows; every insert in code names `account_id`.
- `fileWatched(file)` adds `pl.account_id = @account AND` before `pl.media_id`, and `cardWatched` inherits it. `FROM_MEDIA` joins `p` and `f` `ON p.account_id = @account AND p.media_id = m.id`. Every statement built from these binds `{ account }` beside its positional values (spike, step 1).
- `MediaRepository` takes `account: AccountKey` in every read that returns a `MediaItem` or depends on watched state, each as one object parameter: `getMany({ ids, account })`, `get({ id, account })`, `list({ ..., account })`, `listShows({ ..., account })`, `nextEpisode({ ..., account })`, `randomEpisode({ ..., account })`, `watchedEpisodes({ ids, account })`, `listUnmatched({ ..., account })`, `forItem({ itemId, account })`, `forItems({ itemIds, account })`, `listInProgress({ libraryId, account })`, `listFavourites({ libraryId, account })`, `listSagas({ libraryId, account })`. `backdropOf` and `withPosters` do not change.
- `ViewingRepository`: `setFavourite({ id, favourite, account })`, `recordPlay({ id, account, at })`, `report({ id, position, account, at })`, `history({ libraryId, limit, watchedOnly, account })`; `notePlay` continues only that account's latest play.
- `WatchedRepository.set({ cards, watched, at, account })`: marks, set-asides and spot clearing touch only that account's rows.
- `TitleFavourites`: `favouriteOf({ itemId, account })`, `set({ itemId, favourite, account })`, `list({ account })`. `itemChildren` and `movieSplits` take `account` and pass it on.
- Produces: `ViewingAccounts.keyOf({ request }: { request: FastifyRequest }): AccountKey`, consuming `AuthSessions.callerOf` and `CALLERS` (enforcement Task 2). It switches on `caller.kind`, with a `never` default: `legacy` gives `VIEWING_ACCOUNTS.local` (Task 3 adds the recorded owner); `session` and `ticket` give `account.id`.
- Every handler that reads or writes viewing data takes `@Req() request` (most already do after enforcement Task 4) and passes `account: this.accounts.keyOf({ request })`. Owner-only handlers that return `MediaItem`s (`match`, `streams`, `unmatched`, `duplicates`) pass the owner's own key.
- `PRODUCTION_STATISTICS`: replace `['favourites', null, '1']` with `['favourites', 'sqlite_autoindex_favourites_1', '1 1 1']` and `['playback_progress', null, '11']` with `['playback_progress', 'sqlite_autoindex_playback_progress_1', '11 11 1']`; add `['item_favourites', 'sqlite_autoindex_item_favourites_1', '1 1 1']` and `['plays', 'plays_account', '8 8 1 1']`, keeping `plays_media`. These are the real counts under one account, which is what a server holds the day it migrates.
- `test/repositories.ts` exports `TEST_ACCOUNTS = { a: VIEWING_ACCOUNTS.local, b: '30000000-0000-4000-8000-000000000002' } as const` for repository tests.

- [x] **Step 1:** In `database.test.ts`, write `it('gives every viewing row to the local account')`. Migrate a database with `MIGRATIONS.slice(0, -1)`, insert a spot, a favourite, a title favourite and two plays (`played`, `marked`), then migrate the rest. Each row is there with `account_id = 'local'`; inserting a play of kind `'bogus'` still throws; deleting the media row removes its spot, favourite and plays; and `PRAGMA foreign_key_check` is empty.
- [x] **Step 2:** In each repository test, add a second-account case beside the existing ones, which now pass `account: TEST_ACCOUNTS.a`. A's spot, favourite, title favourite, play and Mark as watched are invisible to B: `position` 0, `favourite` false, `watched` false, empty history and in progress, B's Up next still the first episode, B's season watched count 0. B's Mark as unwatched leaves A's marks, and `notePlay` for B never continues A's sitting.
- [x] **Step 3:** In `listingPlans.test.ts` and `queryPlans.test.ts`, assert that the plans for `list`, `listShows`, `listInProgress`, `history` and `watchedEpisodes` search `playback_progress` and `favourites` by primary key and `plays` by `plays_account`, with no `SCAN pl` or `SCAN p`.
- [x] **Step 4:** `viewingAccounts.test.ts` with a fake `callerOf`: `legacy` gives `'local'`, a session or a ticket gives its account's id.
- [x] **Step 5:** Run `bunx nx run @raven/server:test`. Expected: FAIL. Implement the migration, the fragments, the repositories, `ViewingAccounts` and the controller wiring. Run again: PASS, with every existing app test (`app.test.ts`, `appWatched.test.ts`, `appLock.test.ts`, `appMediaPlane.test.ts`, `appAuth.test.ts`, `appEnforcement.test.ts`) unchanged, since under `off` everything reads and writes `'local'`. `:typecheck` and `:lint:ts` clean.
- [x] **Step 6:** Commit `MAE: key raven's viewing rows by account`.

### Task 2: Each account sees only its own

**Files:**
- Create: `apps/raven/server/src/appAccountData.test.ts`
- Modify: `apps/raven/server/src/test/auth.ts`, `apps/raven/server/src/test/enforced.ts`

**Interfaces:**
- Consumes: `createEnforcedApp` and `headersFor` (enforcement Task 2).
- `test/auth.ts`: add `AUTH_TEST_IDS.guest = '20000000-0000-4000-8000-000000000006'`, an approved non-owner `guest@maester.test`. Check that #239's member-listing tests still count what they expect.
- `test/enforced.ts`: add `CALLER_KINDS.guest`, and have `createEnforcedApp` also scan a small TV library (two episodes of one show, from `appWatched.test.ts`'s fixture) so Up next and season counts can be tested.

- [x] **Step 1:** Write `it('keeps each account's viewing to itself')`. As the member: `PUT progress` to 30 s, `POST plays`, `PUT favourite` on a movie, `PUT /api/items/:show/favourite`, and `PUT /api/watched` on episode 1. Then, as the guest, read every per-account route listed under "Per-viewer data inventory" and find none of it: `position` 0, `favourite` false, `watched` false, empty history, in progress, favourites and title favourites, Up next on episode 1, season watched count 0, and an empty Continue watching on Home. As the member, the same reads show all of it.
- [x] **Step 2:** Write `it('answers per-account reads uncached')`. For each of those routes, as the member with Bearer and again with the cookie, `cache-control` is `no-store` (never `public`) and `Vary` names `authorization` and `cookie`. With `accept-encoding: gzip` on the large `GET /api/libraries/:id/media`, the reply is gzip and `Vary` names `accept-encoding` as well as both.
- [x] **Step 3:** Write `it('keeps a removed account's viewing for when it returns')`. The owner removes the member through `/api/auth/members/:id/status`, and the member gets 403 `revoked`. The owner approves the member again, and the member's spot, favourite and marks are back.
- [x] **Step 4:** Run. Expected: PASS after Task 1. A failure is a binding Task 1 missed: fix it in Task 1's files, never in the test.
- [x] **Step 5:** Commit `MAE: test that each raven account sees only its own viewing`.

### Task 3: The owner adopts the history from before accounts

**Files:**
- Create: `apps/raven/server/src/media/viewingAdoption.ts`, `viewingAdoption.test.ts`
- Modify: `apps/raven/server/src/media/viewingAccounts.ts`, `viewingAccounts.test.ts`, `apps/raven/server/src/settings/settingsRepository.ts` and its test, `apps/raven/server/src/appModule.ts`, `apps/raven/server/src/appAccountData.test.ts`

**Interfaces:**
- Consumes: `AUTH_STATE` and `SETTINGS_KEYS` (enforcement Task 1).
- Produces: `SETTINGS_KEYS.viewing = 'viewing'`. In `SettingsRepository`, `viewingOwner(): string | null` reads `{ ownerId }` through a guard, `isViewingRecord = object({ ownerId: isAccountId, adoptedAt: isString })` from core's combinators and `isAccountId`, and `markViewingOwner({ ownerId, at }: { ownerId: string; at: Date }): void` writes it.
- Produces: `ViewingAdoption.adopt({ ownerId }: { ownerId: string }): AdoptedCounts`, where `type AdoptedCounts = { spots: number; plays: number; favourites: number; titleFavourites: number }`. It is one `db.transaction` holding the three merges and the plays `UPDATE` (as in the spike), the `DELETE`s of `'local'` rows, and `markViewingOwner`. Also `hasLocalRows(): boolean`, one `SELECT EXISTS` per table for `account_id = 'local'`.
- `ViewingAccounts.keyOf` grows:
  - `legacy` under `off` gives `settings.viewingOwner() ?? VIEWING_ACCOUNTS.local`, read once at construction (it changes only by adoption, which only `ready` runs); under `ready` or `unavailable` an unbound request stays on `'local'`.
  - `session` and `ticket`: when `account.isOwner`, its status is approved and an adoption is pending, adopt first, log `Gave the owner the viewing history from before accounts: <n> plays, <n> resume spots, <n> favourites` (counts only), and clear the pending flag. A failed adoption rolls back, is logged with the SQLite code alone, and is retried at most once per request and not before `ADOPTION_RETRY_MS` (60 s) has passed.
  - The pending flag is computed at construction: auth state `ready` and `hasLocalRows()`. It never turns true again in that process, since nothing writes `'local'` under `ready`.

- [x] **Step 1:** `viewingAdoption.test.ts` on a real migrated database. Adoption moves every `'local'` row and records the owner, and a second call returns all zeros and changes nothing. When the owner already has a row for the same title, the newer spot and the earlier favourite time win. A forced failure (a trigger raising inside the transaction) leaves every `'local'` row and no `viewing` setting.
- [x] **Step 2:** `viewingAccounts.test.ts`: `off` with a recorded owner gives the owner's UUID; a member adopts nothing; the owner adopts once, and the second request runs no adoption (spy on `ViewingAdoption.adopt`); a pending or revoked owner, which the gate never lets through, still adopts nothing.
- [x] **Step 3:** In `appAccountData.test.ts`, write `it('gives the owner what was watched before accounts')`. On one data dir, start `off` (plain `createApp`) and save a spot, a favourite, a title favourite, a play and a mark, then close. Start `ready` on the same dir. The member reads first and sees none of it. The owner's first `GET /api/home` shows the spot in Continue watching, and the favourites, history and marks are the owner's. The member still sees none. `SELECT COUNT(*) ... WHERE account_id = 'local'` is 0 in all four tables.
- [x] **Step 4:** Write `it('lets servers without accounts keep the owner's viewing after a rollback')`. Continue on that dir with `isAccountsOptedOut: true` (enforcement Task 1, renamed from `accountsOptOut`), so the state is `off`. An anonymous read shows the owner's spot, and an anonymous `PUT progress` on another title lands under the owner's UUID (assert in SQL). Start `ready` again: the owner sees both spots, the member neither.
- [x] **Step 5:** Write `it('merges a later adoption')`. Write a `'local'` spot directly, older than the owner's for the same title, and another for a new title. Restart `ready`: the owner's next request keeps the owner's newer spot, gains the new title's spot, and leaves no `'local'` rows.
- [x] **Step 6:** Run: FAIL. Implement. Run: PASS.
- [x] **Step 7:** Commit `MAE: give raven's pre-account viewing history to the owner`.

### Task 4: raven player follows the account

**Files:**
- Modify: `apps/raven/desktop/src/main/accounts/accountSessions.ts` (desktop Task 4), `accounts/accountService.ts` (desktop Task 6), `apps/raven/desktop/src/main/downloads/downloadState.ts`, `downloadStore.ts`, `playback.ts`, `sync.ts`, `apps/raven/desktop/src/main/desktopService.ts`, `apps/raven/desktop/src/main/main.ts` (wiring only), `apps/raven/desktop/src/renderer/Shell/Shell.tsx`, and the tests beside each

**Interfaces:**
- Produces: `accountSessions.accountIdOf({ serverId }): string | null`, the stored session's `user.id`, read without a network call. It stays in main; the renderer never receives it.
- Download store version 2: `Pending` and `Owed` gain `accountId: string | null`. Version 1 upgrades with `null`, which means "made before accounts" and is sent as today, to whoever is signed in. `NO_PENDING.accountId` is `null`.
- `playback.ts`: a play or position noted for a download of a `ready` server is tagged with `accountIdOf`. With no session for that server it is not queued (Question 2). Downloads of `off` and `legacy` servers are untouched (`null`).
- `sync.ts`: a pending or owed item is sent only when its `accountId` is `null` or equals `accountIdOf` for its server; otherwise it waits.
- On a successful sign in to a different account, or a sign out (`accountService`), main moves that server's downloads' pending to `owed` under the outgoing `accountId` (the path a removed download already takes) and calls `removeServerRecents({ serverId })`. Owed items wait until their account signs in on that server again.
- `Shell.tsx`: built differently from the brief's reset. A reset on every `account` event tore down a title being played, so main sends a separate `accountSwitched` event carrying only the server id when that server's account really changes, and the renderer invalidates every query under `['desktop', 'server', serverId]` (a key prefix declared once beside `SERVERS_KEY`) and the recents query with `refetchType: 'none'`; a plain `account` event invalidates only the account query.
- Built beyond the brief: `ServerCalls` checks each token's own `sub` against the item's account before sending, and `downloads.json` version 2 carries `accountId` on pending and owed plays.

- [x] **Step 1:** Tests: a v1 store upgrades with `accountId: null`; A's offline play is tagged A; A signs out, so the pending moves to owed under A and nothing is sent; B signs in and nothing of A's is sent; A signs in again and A's owed play is sent once with A's Bearer (assert the fake calls see A's token). A play while signed out of a `ready` server is not queued. An `off` server's downloads sync exactly as before. Sign out removes that server's recents and keeps other servers' and local ones. The `account` event resets the server's queries (renderer test with a spy `QueryClient`).
- [x] **Step 2:** Run `bunx nx run @raven/desktop:test`: FAIL. Implement. Run: PASS; `:typecheck`, `:lint:ts`, `bun run dead-code` pass.
- [x] **Step 3:** Commit `MAE: keep raven player's offline plays and recents with their account`.

### Task 5: raven web shows each account its own

**Files:**
- Modify: `apps/raven/web/src/pages/HomePage/HomePage.test.tsx`, `apps/raven/web/src/pages/FavouritesPage/FavouritesPage.test.tsx` (tests only; no web source changes are expected)

- [x] **Step 1:** Test with the fetch spy: render Home as account A (Continue watching shows A's title), then switch the session store to account B. The in-progress query is refetched with B's token, A's card is gone before B's answer arrives (reset, not stale), and no request after the switch carries A's token. The same for Favourites.
- [x] **Step 2:** Run `bunx nx run @raven/web:test`. Expected: PASS already, through `clearAccountState` (#247). If it fails, the fix goes in `clearAccountState` or the session store, not in the pages. Coverage floors hold.
- [x] **Step 3:** Commit `MAE: test that raven web shows each account its own viewing`.

### Task 6: Docs, verification, walkthrough and the PR

**Files:**
- Modify: `apps/raven/README.md` (Accounts: each account has its own progress, plays, watched and favourites; the owner keeps what was recorded before; removal keeps an account's history for its return; servers without accounts share one viewer, and a rollback shows the owner's; library view settings are still shared), `apps/raven/CLAUDE.md` (Conventions: per-account tables are read and written only with `@account` from `ViewingAccounts.keyOf`; a new per-viewer table gets `account_id` and a row in the isolation suite), `apps/raven/supabase/README.md` (drop the "tell members viewing data is shared" step; note that adoption happens on the owner's first visit after the deploy), `docs/superpowers/plans/2026-10-17-supabase-sign-in.md` (link this plan in the `raven-account-data` row; tick it), `docs/superpowers/plans/2026-10-18-raven-auth-enforcement.md` (operator step 10 points here), the spec's status line and its "Viewing data" scope row
- No source files.

- [x] **Step 1:** `bunx nx run-many -t test typecheck lint:ts format:check -p @raven/server @raven/desktop @raven/web`, then `bun run verify`. All pass.
- [ ] **Step 2 (not done: `bunx nx run @raven/supabase:db:start` never got past `Starting database from backup...` in 5 minutes, with `supabase_kong_raven` stuck at Created, so the local stack never came up and the walkthrough below was not run):** Local walkthrough with the `run` skill. Start `bunx nx run @raven/supabase:db:start`, then raven `off` on a throwaway data dir with a small movie and TV library.
  - As the anonymous viewer: play a movie to 40%, favourite it, favourite a show, mark episode 1 watched. Stop raven.
  - Start it `ready` on the same data dir. Sign in as `friend@maester.test` (approved, password `RavenLocal123!`): Continue watching, Favourites, the show's watched marks and the library history are empty.
  - In another browser, sign in as `owner@maester.test`: everything from the anonymous session is there (adoption). The server log has the counts line and no id or email.
  - As friend: play another title to 30%, favourite it and mark episode 2 watched. As owner: none of friend's activity shows, and the owner's own is unchanged. Sign up a third account, confirm it through Mailpit and approve it as owner: it sees neither.
  - Owner removes friend, then approves friend again: friend's history is back.
  - Stop, restart with `RAVEN_ACCOUNTS=off` and no Supabase env: the anonymous viewer sees the owner's history. Restart `ready`: owner unchanged, friend unchanged.
  - Desktop (Apple Silicon): sign in as friend, play a server title and a download offline, sign out, sign in as owner. Friend's play is not in owner's history and Home has no friend recents. Sign in as friend again and the offline play arrives in friend's history.
  - Write down what was and was not seen. `db:stop` after.
- [ ] **Step 3 (not done: it reads production data on the NAS and is the user's call):** Time the account migration and the first owner request on a copy of Vhagar's `raven.db` (never the live file): note both durations and the row counts moved. Delete the copy after.
- [x] **Step 4:** Commit `MAE: document raven's per-account viewing data`.
- [ ] **Step 5 (not done here: #256 is open and pushed by the controller):** When the user asks, push and open the PR with base `raven-auth-enforcement`, per `pr-format`. List in it what is not verifiable locally: the migration and adoption on Vhagar itself, and real members' devices.

---

## Operator note for the deploy

- Back up `/volume1/docker/raven/data` first: the account migration rewrites three tables, and there is no down migration.
- After the deploy, the owner signs in once before telling members: that visit adopts the pre-account history. Until then members simply see empty lists.
- Members' plays from the period after enforcement and before this deploy are in the owner's history, since raven never recorded who made them (A9).

## Risks

- **Query plans.** Every listing gains a key condition. A wrong `PRODUCTION_STATISTICS` row could make the planner scan `plays` on real data; Task 1's plan assertions and Task 6's timing on a real copy guard it.
- **Signature churn.** About 25 call sites and six test files change for the `account` parameter. A missed one is a compile error, never a silent shared read, because the parameter is required.
- **Ownership transfer.** If the owner UUID later changes (an operator procedure, not a flow), the old owner keeps their rows, the new owner starts empty, and a rollback to `off` shows the old owner's history. Recorded in the README.
- **Owner never signs in.** The `'local'` rows wait, harmlessly, and nobody sees them.
- **Desktop store version 2.** An older raven player cannot read a version 2 store and sets it aside as unreadable (`LoadedDownloads.wasSetAside`), losing its pending plays. Downgrades are not supported today either.
- **No down migration.** Restoring the backup is the only way back past the account migration.

## Self-review

- **Spec coverage:** separate progress, plays, watched and favourites per account (Tasks 1 and 2); existing rows migrated to the owner (Task 3); a server without accounts unchanged (A2, Task 1's existing suites, Task 3's rollback); desktop and web clients follow the account (Tasks 4 and 5); no claim of isolation before this ships (Task 6's docs).
- **Decisions:** A1 and A3 Task 1; A2 and A4 Task 3; A5 Task 2, step 3; A6 Global Constraints; A7 Task 2, step 2; A8 Task 4; A9 the operator note. Questions 1 and 2 change only Task 4 (question 2) or one route mark in enforcement's inventory (question 1).
- **Consistency:** `VIEWING_ACCOUNTS`, `AccountKey`, `ViewingAccounts.keyOf`, `ViewingAdoption.adopt`, `SETTINGS_KEYS.viewing`, `TEST_ACCOUNTS`, `AUTH_TEST_IDS.guest` and `accountIdOf` are each defined once and reused.
