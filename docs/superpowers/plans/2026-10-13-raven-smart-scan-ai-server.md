# raven smart scan, step 4: the AI lookup, server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `ANTHROPIC_API_KEY` set, every show folder or movie the matcher leaves unmatched gets one Claude lookup over real TMDB results after a pass: a confident (`high`) pick matches the files, a `low` pick is offered as a suggestion, and the API tells the web app which is which.

**Architecture:**
- `AiClient` wraps `@anthropic-ai/sdk` with raven's own key and a `fetch` injected under `AI_FETCH`, counts the day's lookups, and reports `off`, `ok` or `failing`.
- `AiMatcher` runs one lookup as a manual tool loop: three strict tools (`search_tmdb`, `list_episodes`, `choose_match`) whose inputs are checked with guards, a stable cached system prompt, at most six turns.
- `AiDecisions` stores each lookup's outcome in `ai_decisions` by library and place, as `match_overrides` keeps Fix match.
- `MetadataService` asks about the groups a pass left unmatched, two at a time, and matches a group again at once when the pick is `high`. `MatchPass.resolve` takes that pick after the search.
- The contract gains `aiSuggestion` on the Not matched listing, `aiMatch` on item details, and `ai`/`aiRemaining` on `MetadataHealth`.

**Tech Stack:** NestJS 12, vitest and better-sqlite3 (server); `@anthropic-ai/sdk` 0.133.0 (pinned exact); `@raven/core` schema combinators and bun test (core); bun test with happy-dom (web fixtures only in this step).

**Spec:** `docs/superpowers/specs/2026-10-12-raven-smart-scan-design.md`, section 3 ("AI lookup for what is left"), the S3 outcomes, "Order of work" step 4, "Testing" and "Work in flight". It builds on step 3 (`docs/superpowers/plans/2026-10-13-raven-smart-scan-types.md`).

## Global Constraints

- Every rule in the root `CLAUDE.md` holds:
  - no `any`, no casts, and no non-null assertions outside tests;
  - `type`, never `interface`, and no enums;
  - named exports only;
  - no `for`, `for...of` or `for...in` loops;
  - one object parameter wherever there are two or more;
  - `@/` imports with no extension;
  - `??` over `||`, except where an empty string must count as unset;
  - no em or en dashes anywhere, comments, prompt text and UI copy included.
- `libs/raven/core` stays free of DOM and Node APIs.
- New API shapes are guards in `libs/raven/core/src/contract.ts` built from the `schema.ts` combinators, with their types read off them. Claude's tool inputs are untrusted and are checked with guards built from the same combinators before anything runs.
- Server constructors inject with explicit `@Inject(Token)`.
- The decisions from the spec, binding:
  - Claude Haiku 5.5 (`claude-haiku-5-5`) is the default model; `AI_MATCH_EFFORT` defaults to `low` and is always sent as `output_config.effort`, since Haiku 5.5's own default is `medium`;
  - adaptive thinking (`thinking: { type: 'adaptive' }`), `max_tokens` 4000, `tool_choice: { type: 'auto' }`, strict tools;
  - never send `budget_tokens`, `temperature`, `top_p`, `top_k`, an assistant prefill or a `fallbacks` parameter: each is a 400 on Haiku 5.5;
  - each reply is appended whole (`response.content`, thinking blocks included) and the history is never edited, so thinking blocks stay valid;
  - a `refusal` stop reason, an end without `choose_match`, an id `search_tmdb` never returned and a seventh turn are all "no decision";
  - a `high` pick applies, a `low` pick is a suggestion;
  - the key is raven's own: the SDK client gets it explicitly, with `authToken: null` and a fixed `baseURL`, so no token, profile or base URL from the environment is used. It is never logged or sent to a client.
- What Claude is sent holds no absolute path and nothing outside the library. Sports, YouTube and Other libraries are never looked up.
- `@anthropic-ai/sdk` is pinned to `0.133.0` exactly, as every dependency in `apps/raven/server/package.json` is. Its client takes a `fetch` option (`ClientOptions['fetch']`, checked in the 0.133.0 tarball).
- Never edit a shipped migration. This step appends migration 20, after step 2's 19. `probe_version` (transcoding S1) is not on `origin/main` as of this plan; if it lands first, append after it and bump the numbers in Task 2's migration test by one.
- Run tasks through Nx from the repo root:
  - `bunx nx run @raven/server:test`, `bunx nx run @raven/core:test`, `bunx nx run @raven/web:test`;
  - one file at a time with `-- <path>`, as in `bunx nx run @raven/server:test -- src/metadata/aiMatcher.test.ts`;
  - `bunx nx run <project>:typecheck` and `bunx nx run <project>:lint:ts`;
  - `bun run verify` before the PR;
  - `bunx nx run <project>:format` (oxfmt, 100 columns) before every commit, as some of this plan's lines are longer than the formatter allows.
- Commits follow the `commit-format` skill: a `MAE:` subject, a short bullet body, written with a heredoc, and no agent attribution. That skill forbids naming the assistant's vendor anywhere in a commit, so subjects and bodies say "the AI lookup", "its key" and "the SDK", never the vendor, the model or the assistant by name.
- Branch `raven-smart-scan-ai-server` from `raven-smart-scan-types`. The PR is stacked on step 3's PR.

## Deviations from the spec, on purpose

- **`ai_decisions` also keeps the pick's `title`, `year` and `poster`.** The Not matched listing then shows a suggestion without a TMDB call per request. They come from the `search_tmdb` result Claude chose.
- **A lookup that ends without a decision is still recorded** (`tmdb_id` NULL, `confidence` `low`, the reason saying why), so it is not asked again until Match again. An Anthropic or TMDB failure is not a lookup: nothing is recorded, and the group is asked on the next pass.
- **A library's decisions are forgotten when its type changes or its files are placed again** (`changeKind` and a relayout that moved files). Their places, and the type Claude was told, no longer hold. Step 3's `changePreference` (a type that reads files the same way but prefers other results) forgets only the undecided and `low` ones, as the final review found: places do not move there, and forgetting a sure pick could unlink an AI-only match and clear it up with its edits. A movie library's files stay linked through a relayout, so their "Matched by AI" note goes with the decision; a group only an AI pick matched is asked again.
- **Offered ids are kept by type and id.** TMDB's movie and TV ids overlap, so a movie id `search_tmdb` returned in a TV library is never taken. `list_episodes` only lists a show `search_tmdb` returned in the same lookup.
- **The tool input guards live in the server** (`metadata/aiTools.ts`), built from `@raven/core`'s combinators. They check what Claude sends, not an API shape, so they stay out of `contract.ts`.
- **"Whether the key is set" is `MetadataHealth.ai === 'off'`.** `off` means exactly that, so the dialog needs no other field.
- **`aiSuggestion` rides on `GET /api/libraries/:id/unmatched` only**, now `UnmatchedFile[]`. The shows listing's `unmatched` stays `MediaItem[]`.
- **"Matched by AI" is read, not stored.** Item details say it when one of the item's files that the viewer may see is `matched` (not `manual`) and a `high` decision at that file's group place chose the item's TMDB id. If a later search lands on the same id, the note still shows.
- **Groups the day's limit skipped wait for the library's next pass** (a scan, a change, a restart or Match again). Nothing else schedules them.
- **Thinking is sent as `{ type: 'adaptive' }` explicitly**, which is Haiku 5.5's default, so another `AI_MATCH_MODEL` thinks too.
- **Two cache breakpoints.** One sits on the system prompt and caches the tools with it (well over Haiku 5.5's 512-token minimum). Top-level automatic caching covers the conversation inside one lookup.
- **File names are sent as paths inside the group's place**, such as `Season 1/Doctor Who - S01E01 - ....mkv`, so season folders show.
- **`MatchPass.resolve` takes the pick as `decided`.** The matcher reads it from `AiDecisions`, as it reads the Fix match, so a pass never reads storage itself. `matchPending` now takes its pass, so the lookups reuse the pass's cached searches.

- **A lookup that fails on Anthropic or TMDB still spends one of the day's lookups.** `take()` runs before the lookup, as the request may have been billed; the group is asked again on the next pass.
- **A group whose Fix match points at a TMDB id that TMDB cannot resolve is never asked.** The spec excludes only "not a match"; a Fix match is the user's answer either way.
- **A refused key stops lookups until a restart,** and health then reports `ai: 'failing'` with `aiRemaining` 0.
- **The show name read from a file reaches Claude only among the searches tried,** and only when it differs from the folder's.

## Amendments from the pre-flight scan

Each task reads these before its own steps; where one names a task, it binds that task's code.

- Task 1: `remaining()` answers 0 once the key was refused (`status.refused`), so health never reports lookups left that will not run. Derive `AiState`'s `state` from core's `MetadataServiceState` rather than writing the union again. Name the refused flag as a predicate (`isRefused`). The doc comment that says the client takes "nothing else from the environment" should say the key, token, profile and base URL come from raven's own config (the SDK still adds `ANTHROPIC_CUSTOM_HEADERS` if set). In `fakeClaude`'s message body add `diagnostics: null`, as 0.133.0's `Message` has it.
- Task 4: name the lookups' stop flag as a predicate: `const lookups = { isHalted: false }`, passed as `lookups`, typed `{ isHalted: boolean }`, read as `lookups.isHalted`.
- Task 5: `apps/raven/web/src/test/fixtures.ts` already starts `import type { ... } from '@raven/core'`, so add plain `UnmatchedFile` to that list (a `type` modifier inside it does not compile).

## Review Focus

1. **A pick Claude was never offered is never applied.** That covers an id no search returned, and a movie id offered in a TV library (the two id spaces overlap). Pinned in Task 3 (`throws away an id...` cases).
2. **A user's Fix match always wins.** A `high` pick never overrides one, and a "Not a show" Fix match keeps its group from ever being asked. Pinned in Task 4 (`MatchPass` order test, and the end to end Match again test).
3. **Nothing outside the library reaches Claude.** No absolute path, and no name from an Other, Sports or YouTube library. Pinned in Task 3 (`aiGroupOf` never holds the library path) and Task 4 (no request holds the temp root or the Other library's file name).
4. **Anthropic down, a refused key or a refusal never blocks matching or loses a group.** An outage records nothing and the next pass asks again. A refused key stops lookups until a restart. A refusal is no decision. Pinned in Task 1 (refused key), Task 3 (refusal) and Task 4 (Anthropic away, then back).
5. **The conversation is append-only.** Each request starts with the previous request's messages, then Claude's reply exactly as it came, thinking blocks and signatures included. Pinned in Task 3.

---

## Files

| File | Change |
| --- | --- |
| `apps/raven/server/src/lock/lockService.ts`, `src/appLock.test.ts` | Task 0: an item no library holds is hidden under a lock |
| `apps/raven/server/src/test/fakeTmdb.ts` | Task 0: `state.failing` |
| `apps/raven/server/src/metadata/libraryTypes.test.ts` | Task 0: the carry-over tests |
| `apps/raven/server/src/metadata/matchFiles.ts` | Task 0: the `matched` comment |
| `apps/raven/server/package.json`, `bun.lock` | `@anthropic-ai/sdk` 0.133.0 |
| `apps/raven/server/src/config.ts` | `anthropicApiKey`, `aiMatchModel`, `aiMatchEffort`, `aiDailyLimit` |
| `apps/raven/server/src/config.test.ts` (new) | the four variables |
| `apps/raven/server/src/metadata/aiClient.ts` (new) | `AI_FETCH`, `AiFetch`, `AiError`, `AiClient` |
| `apps/raven/server/src/metadata/aiClient.test.ts` (new) | key, daily limit, refused key, failing |
| `apps/raven/server/src/test/fakeClaude.ts` (new) | Claude in miniature, scripted per place |
| `apps/raven/server/src/app.ts`, `appModule.ts` | `aiFetch`; providers `AI_FETCH`, `AiClient`, `AiDecisions`, `AiMatcher` |
| `apps/raven/server/src/db/database.ts`, `database.test.ts` | migration 20, `ai_decisions` |
| `apps/raven/server/src/metadata/aiDecisions.ts` (new) | `isAiConfidence`, `AiPick`, `AiOutcome`, `DecisionPlace`, `AiDecisions` |
| `apps/raven/server/src/metadata/aiDecisions.test.ts` (new) | storage |
| `apps/raven/server/src/metadata/aiTools.ts` (new) | the system prompt, the three tools, their input guards, `AiGroup`, `askFor`, `describeCandidate` |
| `apps/raven/server/src/metadata/aiMatcher.ts` (new) | `aiGroupOf`, `AiMatcher` |
| `apps/raven/server/src/metadata/aiMatcher.test.ts` (new) | the lookup loop and the group description |
| `apps/raven/server/src/metadata/matchers.ts` | `readShowFile`, `showSearchTitles`, `movieSearchTitles`; `MatcherDeps.decisions`; `decided` |
| `apps/raven/server/src/metadata/matchers.test.ts` | `decisions` dep |
| `apps/raven/server/src/metadata/matchPass.ts`, `matchPass.test.ts` | `resolve({ decided })` after the search |
| `apps/raven/server/src/metadata/places.ts`, `places.test.ts` | `groupPlaceOf` |
| `apps/raven/server/src/metadata/matchFiles.ts`, `matchFiles.test.ts` | `unmatched(libraryId)` |
| `apps/raven/server/src/metadata/metadataService.ts` | lookups after a pass; Match again, type change and relayout; `withSuggestions`, `aiMatchFor`, health |
| `apps/raven/server/src/metadata/aiLookup.test.ts` (new) | end to end |
| `apps/raven/server/src/metadata/metadataRepository.ts` | `details` leaves `aiMatch` to the controller |
| `apps/raven/server/src/libraries/librariesController.ts` | `/unmatched` answers `UnmatchedFile[]` |
| `apps/raven/server/src/items/itemsController.ts` | `aiMatch` on item details |
| `apps/raven/server/src/metadata/movies.test.ts` | the health check says the lookup is off |
| `libs/raven/core/src/contract.ts`, `contract.test.ts` | `isAiMatch`, `ItemDetails.aiMatch`, `isAiSuggestion`, `isUnmatchedFile`, `isUnmatchedList`, `MetadataHealth.ai`, `aiRemaining` |
| `libs/raven/core/src/apiClient.ts`, `apiClient.test.ts` | `listUnmatched` answers `UnmatchedFile[]` |
| `libs/raven/core/src/test/fixtures.ts` | `itemDetails` gains `aiMatch: null` |
| `apps/raven/web/src/test/fixtures.ts` | `itemDetails` gains `aiMatch: null`; `unmatchedFile` |
| `apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx`, `LibraryPage.test.tsx` | typed mocks gain the new fields |
| `apps/raven/.env.example`, `apps/raven/README.md` | the four variables; how the lookup works |

---

### Task 0: Carry-over from step 3's review

Step 3's last review left five narrow faults in code this step touches next. Fix them first, each with a test that fails before the change.

**Files:**
- Modify: `apps/raven/server/src/lock/lockService.ts` (`viewer`, `seesItem`)
- Modify: `apps/raven/server/src/metadata/metadataService.ts` (`changeKind`, `changePreference`, `pass`)
- Modify: `apps/raven/server/src/metadata/matchers.ts` (`matchShowGroup`)
- Modify: `apps/raven/server/src/metadata/matchFiles.ts` (the `matched` comment)
- Modify: `apps/raven/server/src/test/fakeTmdb.ts` (`state.failing`)
- Modify: `apps/raven/server/src/appLock.test.ts`
- Modify: `apps/raven/server/src/metadata/libraryTypes.test.ts`

**Interfaces:**
- Consumes: step 3's `changePreference`, `repick`, `matchGroups`, `pass` (the clear-up skipped when TMDB stopped the pass), `MatchFiles.setMatch`, `MatchFiles.matched`.
- Produces: `fakeTmdb(...).state.failing: string[]`, URL paths (after `/3`) whose calls fail as if TMDB were down. `matchShowGroup` in `matchers.ts` puts a show folder back to `pending` when placing its episodes fails part way. No public signature changes.

The five faults:

1. **A stopped pass keeps a locked library's items readable.** Since step 3, a pass TMDB stops skips the clear-up, so after a type change of a locked library during an outage its unlinked items stay, and `LockService.viewer`'s `seesItem` lets anyone read an item no library holds (`holding.length === 0`). Fix: while a lock applies to the viewer (the branch after `EVERYTHING` is returned), an item no library holds is hidden: `holding.length > 0 && holding.some(seesLibrary)`.
2. **A layout saved with a type change can be lost.** `changePreference` returns early when the type changed again before its task ran, and skips `relayoutNow` with it. Fix: call `this.relayoutNow(libraryId)` first, before the type check (it reads the settings as they are then).
3. **A save that repeats a type change still running is dropped.** `changeKind` and `changePreference` queue with `push`, which drops a task whose key is running. While Anime movies to Movies re-picks (`prefer:<id>:movies` running), saving Anime movies and then Movies again drops the last save, so the library ends as Movies with its files picked for Anime movies. Fix: queue both with `this.queue.again(...)`, as `changeLayout` does, so a change saved while one with the same key runs is applied after it.
4. **A library deleted while its pass runs is not cleared up if the pass stops.** The delete's `enqueue` is dropped while `library:<id>` runs. Fix: in `pass`, skip the clear-up only when TMDB stopped the pass and the library is still there: `if (isStopped && this.libraries.get(libraryId) != null) return`.
5. **A pass TMDB stops halfway through a show can leave its folder under two shows, both still `matched`.** `matchShowGroup` places files one by one after the show is resolved, so a season fetch that fails part way leaves the first files on the new show and the rest on the old, and the pass that follows a re-pick does the same. Fix: in `matchShowGroup` (`apps/raven/server/src/metadata/matchers.ts`), when placing the episodes throws, put every file of the group back to `pending` (`deps.files.setMatch({ ids, match: 'pending' })`), keeping their links so their cards stay, and rethrow so the guard sees the error as before. A later pass matches the folder whole. Movies are untouched: a movie re-pick TMDB stops leaves its files `matched` on their old pick, which `libraryTypes.test.ts`'s "keeps the movie, its edits and its matches when Movies becomes Anime movies while TMDB is away" pins.

Also correct the `matched` comment in `matchFiles.ts`: those files were matched by a search or by an id in a name or NFO, not by a Fix match.

- [ ] **Step 1: Let the fake TMDB fail one path**

In `apps/raven/server/src/test/fakeTmdb.ts`, declare `const failing: string[] = []` before `state` and add `failing` to `state` (no cast: the repo forbids `as string[]`), document it in the comment above `fakeTmdb` (`failing` makes calls to those paths fail as `down` does), and right after the `path` is computed (`parsed.pathname.replace(/^\/3/, '')`), throw the same `TypeError('fetch failed')` as `down` when `state.failing.some((prefix) => path.startsWith(prefix))`.

- [ ] **Step 2: Write the failing tests**

In `apps/raven/server/src/appLock.test.ts`, find how it creates a locked library and checks a hidden item (`@PrivateBy('item')` routes such as `GET /api/items/:id`). Add the test inside the file's "the admin lock" `describe`, where a hidden item answers 404 (outside it, with the admin lock off, a hidden item answers 423): with a locked library and no cookie, an item no library holds answers 404 at `/api/items/:id`; with both cookies (`cookies(state.admin, state.pin)`, as that describe's other tests send them), 200. Make the orphan item the way step 3's own tests do: a movie in the locked library, then its file unlinked through a type change to Other while the fake TMDB is `down` (or, if the file has a simpler way in its setup, save an item with `MetadataRepository.save` and link nothing to it). State in the test name why it matters: "hides an item no library holds while a library is locked".

In `apps/raven/server/src/metadata/libraryTypes.test.ts`, add:

```ts
  it('matches a show again whole when TMDB stops a re-pick halfway through it', async () => {
    // Cowboy Bebop gets a second file, in a season the anime's TMDB entry fails to answer for.
    await encodeClip({
      path: join(state.tv, 'Cowboy Bebop', 'Season 2', 'Cowboy Bebop - S02E01 - Second.mp4'),
      seconds: 1,
    })
    await app().inject({ method: 'POST', url: `/api/libraries/${state.library}/scan` })
    await settle()
    tmdb.state.failing = ['/tv/30991/season/2']
    await setKind('animeShows')
    const states = (await mediaOf()).map((item) => item.match)
    expect(states.every((match) => match === 'pending')).toBe(true)
    tmdb.state.failing = []
    await app().inject({ method: 'POST', url: `/api/libraries/${state.library}/scan` })
    await settle()
    expect(await showYears()).toEqual([1998])
    await setKind('shows')
  })
```

Add the season 2 episode to both fake Cowboy Bebop shows (`2: [{ number: 1, title: 'Second', aired: ... }]`), add a `mediaOf` helper beside `showYears` that lists `/api/libraries/:id/media` with `isMediaList`, and adjust the earlier tests' expectations only if the extra file changes them (it should not: both files sit under one show). If a rescan does not start a pass in this app, use whatever the file's other tests use to get pending files matched (read `ScannerService` and `MetadataService.enqueue`), and say which in your report.

Add a test for faults 2 and 3 together, through a Movies library, as only movie searches can be held (`hold` gates `/search/movie`, never `/search/tv`): read `hold` in `fakeTmdb.ts` first.

- Create a second library in this file's `beforeAll`, kind `animeMovies`, over a new path holding `A/Alien (1979)/Alien (1979).mp4` (a letter folder, so its folder layout matters), with `Alien` (348, 1979) added to the fake's `movies`. Give it its own `settle` coverage.
- The test: hold the search for `alien`; save the library as Movies (this queues `prefer:<id>:movies`, whose re-pick blocks on the held search); then save Anime movies with `folderLayout: 'flat'`; then save Movies again (with `push`, this third save repeats the running key and is dropped). Release the hold and settle.
- Expect: the library's kind is Movies, its layout is `flat` (`GET /api/libraries/:id` settings, and the file's `folder` reads `A/Alien (1979)` again since a flat layout files it under `A`), and its files were picked again after the last save (the fake recorded a `/search/movie` call for `alien` after the release).
- Before the fix this fails: the last save is dropped, and the Anime movies task returns early without placing the files for the flat layout.

If the queue's timing makes any of this unreliable, say so in the report and find another sequence that fails first; do not fall back to a unit test of `createTaskQueue`'s `again`, which already has one and cannot show that these two methods use it.

For fault 4, in the same Movies library or a third one: the library needs one movie already matched (so an item exists; read its id from `/api/items` or the media listing) and a second, pending movie whose search is held. Delete the library through `DELETE /api/libraries/:id` while that pass waits on the hold; set the fake TMDB `down`; release the hold. The held call already passed the `down` check, so it answers; the stop must come from a later call, such as fetching that second movie, which TMDB has not stored. After `settle`, the first movie's item answers 404 at `/api/items/:id`. Before the fix it answers 200, as the stopped pass skipped the clear-up.

- [ ] **Step 3: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/appLock.test.ts src/metadata/libraryTypes.test.ts`
Expected: the new tests FAIL: the orphan item answers 200, one re-picked show file is `matched` under the anime while the other stays on the series, the last save is dropped and the flat layout not applied, the deleted library's item stays.

- [ ] **Step 4: Fix the five faults**

Make the five changes listed above. In `metadataService.ts`:

```ts
  changeKind({ libraryId, kind }: { libraryId: number; kind: LibraryKind }): void {
    this.queue.again(
      `kind:${libraryId}:${kind}`,
```

```ts
  changePreference({ libraryId, kind }: { libraryId: number; kind: LibraryKind }): void {
    this.queue.again(
      `prefer:${libraryId}:${kind}`,
      this.logged(`type change of library ${libraryId}`, async () => {
        // The layout saved with this change is read even when the type moved on since.
        this.relayoutNow(libraryId)
        // A type changed again since then is matched by the change queued after this one.
        if (this.libraries.get(libraryId)?.settings.kind !== kind) return
        this.files.retryUnmatched(libraryId)
        await this.repick({ libraryId, kind })
        await this.pass(libraryId)
      }),
    )
  }
```

```ts
      // The items of files still waiting for TMDB stay, with their edits and
      // pictures, until a pass that gets through matches the files to them
      // again. A library removed meanwhile is cleared up all the same.
      if (isStopped && this.libraries.get(libraryId) != null) return
```

In `matchers.ts`'s `matchShowGroup`, wrap the episode placement:

```ts
    const touched = await episodes
      .reduce<Promise<number[]>>(
        (previous, file) =>
          previous.then(async (items) => [...items, ...(await placeEpisode({ file, show, pass }))]),
        Promise.resolve([]),
      )
      .catch((error: unknown) => {
        // A folder placed in part, say when TMDB went away fetching a season,
        // would sit under two shows; it waits to be matched whole instead.
        deps.files.setMatch({ ids, match: 'pending' })
        throw error
      })
```

In `lockService.ts`'s `viewer`:

```ts
    const seesItem = (itemId: number): boolean => {
      const holding = this.metadata.librariesHolding(itemId)
      // An item no library holds is one a type change or rescan left waiting; it may be a locked library's.
      return holding.some(seesLibrary)
    }
```

(`holding.some` is already false for an empty list.) Check every caller of `seesItem` and `sees({ privacy: 'item' })` for one that relied on an orphan item being visible, such as a person's credits list, and say in the report what you found.

- [ ] **Step 5: Run them to verify they pass**

Run: `bunx nx run @raven/server:test -- src/appLock.test.ts src/metadata/libraryTypes.test.ts src/metadata/shows.test.ts src/metadata/movies.test.ts src/metadata/matchers.test.ts`, then `bunx nx run @raven/server:test`, `bunx nx run @raven/server:typecheck` and `bunx nx run @raven/server:lint:ts`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/raven/server/src/lock/lockService.ts apps/raven/server/src/metadata/metadataService.ts apps/raven/server/src/metadata/matchers.ts apps/raven/server/src/metadata/matchFiles.ts apps/raven/server/src/test/fakeTmdb.ts apps/raven/server/src/appLock.test.ts apps/raven/server/src/metadata/libraryTypes.test.ts
git commit -m "$(cat <<'MSG'
MAE: raven keeps type changes and locked items safe through an outage

- An item no library holds is hidden while a library is locked
- A type change saved while another runs is applied after it, and its layout with it
- A library deleted while its pass runs is cleared up even when TMDB stops the pass
- A show TMDB stops halfway through placing waits to be matched whole
MSG
)"
```

---

### Task 1: Config, the SDK and the AI client

**Files:**
- Modify: `apps/raven/server/package.json`, `bun.lock` (through `bun add`)
- Modify: `apps/raven/server/src/config.ts`
- Create: `apps/raven/server/src/config.test.ts`
- Create: `apps/raven/server/src/metadata/aiClient.ts`
- Create: `apps/raven/server/src/metadata/aiClient.test.ts`
- Create: `apps/raven/server/src/test/fakeClaude.ts`
- Modify: `apps/raven/server/src/app.ts`, `apps/raven/server/src/appModule.ts`
- Modify: `apps/raven/.env.example`, `apps/raven/README.md` (the Configuration table)

**Interfaces:**
- Consumes: `oneOf`, `isRecord`, `isString` from `@raven/core`; `wholeNumber` from `@shared/server`.
- Produces:
  - `ServerConfig.anthropicApiKey: string | null`, `aiMatchModel: string`, `aiMatchEffort: AiMatchEffort`, `aiDailyLimit: number`; `type AiMatchEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
  - `type AiFetch = NonNullable<ClientOptions['fetch']>`, `AI_FETCH: symbol`
  - `class AiError extends Error`
  - `class AiClient`: `enabled: boolean` (getter), `remaining(): number`, `take(): boolean`, `state(): { state: 'off' | 'ok' | 'failing'; error: string | null }`, `send(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>`
  - `createApp({ ..., aiFetch?: AiFetch })`, `AppModule.register({ ..., aiFetch?: AiFetch })`
  - `fakeClaude({ lookups }: { lookups: Readonly<Partial<Record<string, readonly FakeReply[]>>> }): { fetch: AiFetch; state: { status: number; requests: SeenRequest[] } }`
  - `type FakeReply` (`search`, `episodes`, `choose`, `call`, `refuse`, `say`), `type SeenRequest = { url; apiKey; raw; body; place; turn }`

- [ ] **Step 1: Add the SDK**

Run: `bun add --cwd apps/raven/server --exact @anthropic-ai/sdk@0.133.0`
Expected: `apps/raven/server/package.json` lists `"@anthropic-ai/sdk": "0.133.0"` first in `dependencies`, and `bun.lock` changes. The SDK's peer dependency `zod` is optional and stays out.

- [ ] **Step 2: Write the failing config test**

Create `apps/raven/server/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'

describe('readServerConfig', () => {
  it('leaves the AI lookup off without a key, on Haiku 5.5 at low effort, 200 a day', () => {
    expect(readServerConfig({})).toMatchObject({
      anthropicApiKey: null,
      aiMatchModel: 'claude-haiku-5-5',
      aiMatchEffort: 'low',
      aiDailyLimit: 200,
    })
  })

  it('reads the key, the model, the effort and the limit', () => {
    expect(
      readServerConfig({
        ANTHROPIC_API_KEY: ' sk-ant-raven ',
        AI_MATCH_MODEL: 'claude-sonnet-5-5',
        AI_MATCH_EFFORT: 'medium',
        AI_DAILY_LIMIT: '50',
      }),
    ).toMatchObject({
      anthropicApiKey: 'sk-ant-raven',
      aiMatchModel: 'claude-sonnet-5-5',
      aiMatchEffort: 'medium',
      aiDailyLimit: 50,
    })
  })

  it('takes an empty key as none, an effort it does not know as low, and at least one lookup a day', () => {
    expect(
      readServerConfig({ ANTHROPIC_API_KEY: '  ', AI_MATCH_EFFORT: 'extreme', AI_DAILY_LIMIT: '0' }),
    ).toMatchObject({ anthropicApiKey: null, aiMatchEffort: 'low', aiDailyLimit: 1 })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bunx nx run @raven/server:test -- src/config.test.ts`
Expected: FAIL, the four fields are missing.

- [ ] **Step 4: Read the four variables**

In `apps/raven/server/src/config.ts`:

Change the imports to:

```ts
import { resolve } from 'node:path'
import type { Anthropic } from '@anthropic-ai/sdk'
import { type HwAccel, isHwAccel, oneOf } from '@raven/core'
import { flag, type ListenConfig, readListenConfig, wholeNumber } from '@shared/server'
```

Above `ServerConfig`, add:

```ts
/** The effort levels the AI lookup can ask for, as `output_config.effort` takes them. */
const AI_MATCH_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies ReadonlyArray<
  NonNullable<Anthropic.OutputConfig['effort']>
>

const isAiMatchEffort = oneOf(AI_MATCH_EFFORTS)

export type AiMatchEffort = (typeof AI_MATCH_EFFORTS)[number]
```

Add to `ServerConfig`, after `omdbDailyLimit`:

```ts
  /** raven's own Anthropic key, for the AI lookup of what matching leaves; null turns it off. Never logged or sent to a client. */
  anthropicApiKey: string | null
  /** The model the AI lookup asks: `claude-haiku-5-5`. */
  aiMatchModel: string
  /** How hard it thinks, as `output_config.effort`; the spike found `low` enough. */
  aiMatchEffort: AiMatchEffort
  /** AI lookups a day, counted again from midnight UTC. */
  aiDailyLimit: number
```

After `hwAccelFrom`, add:

```ts
/** An unknown or missing AI_MATCH_EFFORT means `low`. */
const aiEffortFrom = (value: string | undefined): AiMatchEffort => {
  const trimmed = value?.trim() ?? ''
  return isAiMatchEffort(trimmed) ? trimmed : 'low'
}
```

In `readServerConfig`, after `omdbDailyLimit`:

```ts
  anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
  aiMatchModel: env.AI_MATCH_MODEL?.trim() || 'claude-haiku-5-5',
  aiMatchEffort: aiEffortFrom(env.AI_MATCH_EFFORT),
  aiDailyLimit: Math.max(1, wholeNumber(env.AI_DAILY_LIMIT) ?? 200),
```

(`||` here, as for every variable in this file: an empty string counts as unset.)

- [ ] **Step 5: Run it to verify it passes**

Run: `bunx nx run @raven/server:test -- src/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the fake Claude**

Create `apps/raven/server/src/test/fakeClaude.ts`:

```ts
import { isRecord, isString } from '@raven/core'
import type { AiFetch } from '@/metadata/aiClient'

/** One reply Claude gives in a lookup, in turn: a tool call, a refusal, or words and no tool. */
export type FakeReply =
  | { kind: 'search'; type: 'movie' | 'show'; query: string; year: number | null }
  | { kind: 'episodes'; tmdbId: string; season: number }
  | { kind: 'choose'; tmdbId: string | null; confidence: 'high' | 'low'; reason: string }
  /** Any tool call, as written, for one raven must refuse to run. */
  | { kind: 'call'; name: string; input: Record<string, unknown> }
  | { kind: 'refuse' }
  | { kind: 'say'; text: string }

/** A request raven sent Claude. */
export type SeenRequest = {
  url: string
  apiKey: string | null
  /** The body as sent. */
  raw: string
  body: Record<string, unknown>
  /** The group its lookup is about, read from the facts its first message gives; null for any other request. */
  place: string | null
  /** How many replies Claude had given in its lookup before it: 0 for a lookup's first request. */
  turn: number
}

const json = ({
  body,
  status = 200,
  headers = {},
}: {
  body: unknown
  status?: number
  headers?: Record<string, string>
}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const messagesOf = (body: Record<string, unknown>): unknown[] =>
  Array.isArray(body.messages) ? body.messages : []

/** The place a lookup is about, read back from the JSON its first message ends with. */
const placeOf = (body: Record<string, unknown>): string | null => {
  const [first] = messagesOf(body)
  const content = isRecord(first) && isString(first.content) ? first.content : ''
  const start = content.indexOf('{')
  if (start < 0) return null
  const facts: unknown = JSON.parse(content.slice(start))
  return isRecord(facts) && isString(facts.place) ? facts.place : null
}

const turnOf = (body: Record<string, unknown>): number =>
  messagesOf(body).filter((message) => isRecord(message) && message.role === 'assistant').length

const toolUse = ({
  turn,
  name,
  input,
}: {
  turn: number
  name: string
  input: Record<string, unknown>
}) => ({ type: 'tool_use', id: `toolu_${turn}`, name, input, caller: { type: 'direct' } })

/**
 * The stop reason and content Claude answers a reply with. Every answer but
 * a refusal opens with a thinking block, as adaptive thinking gives one,
 * which raven must send back exactly as it came.
 */
const answerFor = ({
  reply,
  turn,
}: {
  reply: FakeReply | undefined
  turn: number
}): { stop: string; content: unknown[] } => {
  const thinking = { type: 'thinking', thinking: '', signature: `signature-${turn}` }
  if (reply == null) {
    return { stop: 'end_turn', content: [thinking, { type: 'text', text: 'I could not decide.' }] }
  }
  switch (reply.kind) {
    case 'search':
      return {
        stop: 'tool_use',
        content: [
          thinking,
          toolUse({
            turn,
            name: 'search_tmdb',
            input: { type: reply.type, query: reply.query, year: reply.year },
          }),
        ],
      }
    case 'episodes':
      return {
        stop: 'tool_use',
        content: [
          thinking,
          toolUse({
            turn,
            name: 'list_episodes',
            input: { tmdbId: reply.tmdbId, season: reply.season },
          }),
        ],
      }
    case 'choose':
      return {
        stop: 'tool_use',
        content: [
          thinking,
          toolUse({
            turn,
            name: 'choose_match',
            input: { tmdbId: reply.tmdbId, confidence: reply.confidence, reason: reply.reason },
          }),
        ],
      }
    case 'call':
      return {
        stop: 'tool_use',
        content: [thinking, toolUse({ turn, name: reply.name, input: reply.input })],
      }
    case 'refuse':
      return { stop: 'refusal', content: [] }
    case 'say':
      return { stop: 'end_turn', content: [thinking, { type: 'text', text: reply.text }] }
    default: {
      const unreachable: never = reply
      return unreachable
    }
  }
}

/**
 * Claude in miniature for the AI lookup: each lookup, named by its group's
 * place, gets its replies in turn, then words and no choice. A `status`
 * other than 200 answers every request with that error, marked not to be
 * retried, so a test never waits out the SDK's backoff. `requests` records
 * what raven sent.
 */
export const fakeClaude = ({
  lookups,
}: {
  lookups: Readonly<Partial<Record<string, readonly FakeReply[]>>>
}) => {
  const state: { status: number; requests: SeenRequest[] } = { status: 200, requests: [] }
  const fetch: AiFetch = async (input, init) => {
    const raw = typeof init?.body === 'string' ? init.body : ''
    const parsed: unknown = raw === '' ? null : JSON.parse(raw)
    const body = isRecord(parsed) ? parsed : {}
    const place = placeOf(body)
    const turn = turnOf(body)
    state.requests.push({
      url: String(input),
      apiKey: new Headers(init?.headers).get('x-api-key'),
      raw,
      body,
      place,
      turn,
    })
    if (state.status !== 200) {
      return json({
        body: { type: 'error', error: { type: 'api_error', message: 'Away.' } },
        status: state.status,
        headers: { 'x-should-retry': 'false' },
      })
    }
    const answer = answerFor({ reply: (lookups[place ?? ''] ?? []).at(turn), turn })
    return json({
      body: {
        id: `msg_${state.requests.length}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: answer.content,
        stop_reason: answer.stop,
        stop_sequence: null,
        stop_details:
          answer.stop === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
        container: null,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    })
  }
  return { fetch, state }
}
```

- [ ] **Step 7: Write the failing client tests**

Create `apps/raven/server/src/metadata/aiClient.test.ts`:

```ts
import type { Anthropic } from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerConfig, type ServerConfig } from '@/config'
import { AiClient, AiError } from '@/metadata/aiClient'
import { fakeClaude } from '@/test/fakeClaude'

const ASK: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'claude-haiku-5-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'Hello' }],
}

const config = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
  ...readServerConfig({}),
  anthropicApiKey: 'test-key',
  ...overrides,
})

describe('AiClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is off without a key, and never calls out', async () => {
    const claude = fakeClaude({ lookups: {} })
    const ai = new AiClient(config({ anthropicApiKey: null }), claude.fetch)
    expect(ai.enabled).toBe(false)
    expect(ai.take()).toBe(false)
    expect(ai.remaining()).toBe(0)
    expect(ai.state()).toEqual({ state: 'off', error: null })
    await expect(ai.send(ASK)).rejects.toBeInstanceOf(AiError)
    expect(claude.state.requests).toEqual([])
  })

  it("asks with raven's own key, and is ok once answered", async () => {
    const claude = fakeClaude({ lookups: {} })
    const ai = new AiClient(config(), claude.fetch)
    const answer = await ai.send(ASK)
    expect(answer.stop_reason).toBe('end_turn')
    expect(claude.state.requests.map((request) => [request.url, request.apiKey])).toEqual([
      ['https://api.anthropic.com/v1/messages', 'test-key'],
    ])
    expect(ai.state()).toEqual({ state: 'ok', error: null })
  })

  it('counts lookups against the daily limit, and counts again from midnight UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T23:59:00.000Z'))
    const ai = new AiClient(config({ aiDailyLimit: 2 }), fakeClaude({ lookups: {} }).fetch)
    expect([ai.take(), ai.take(), ai.take()]).toEqual([true, true, false])
    expect(ai.remaining()).toBe(0)
    expect(ai.enabled).toBe(false)
    vi.setSystemTime(new Date('2026-10-14T00:00:01.000Z'))
    expect(ai.remaining()).toBe(2)
    expect(ai.take()).toBe(true)
  })

  it('stops until a restart once the key is refused, never naming the key', async () => {
    const claude = fakeClaude({ lookups: {} })
    claude.state.status = 401
    const ai = new AiClient(config(), claude.fetch)
    await expect(ai.send(ASK)).rejects.toThrow(
      'Anthropic refused the key (401). Check ANTHROPIC_API_KEY and restart.',
    )
    expect(ai.enabled).toBe(false)
    expect(ai.state()).toMatchObject({ state: 'failing' })
    expect(JSON.stringify(ai.state())).not.toContain('test-key')
    claude.state.status = 200
    await expect(ai.send(ASK)).rejects.toBeInstanceOf(AiError)
    expect(claude.state.requests).toHaveLength(1)
  })

  it('is failing while Anthropic answers an error, and ok again after', async () => {
    const claude = fakeClaude({ lookups: {} })
    claude.state.status = 529
    const ai = new AiClient(config(), claude.fetch)
    await expect(ai.send(ASK)).rejects.toThrow('Anthropic answered 529.')
    expect(ai.state()).toEqual({ state: 'failing', error: 'Anthropic answered 529.' })
    expect(ai.enabled).toBe(true)
    claude.state.status = 200
    await ai.send(ASK)
    expect(ai.state()).toEqual({ state: 'ok', error: null })
  })
})
```

- [ ] **Step 8: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/metadata/aiClient.test.ts`
Expected: FAIL, `Cannot find module '@/metadata/aiClient'`.

- [ ] **Step 9: Write the client**

Create `apps/raven/server/src/metadata/aiClient.ts`:

```ts
import {
  Anthropic,
  APIError,
  AuthenticationError,
  type ClientOptions,
  PermissionDeniedError,
} from '@anthropic-ai/sdk'
import { Inject, Injectable } from '@nestjs/common'
import { SERVER_CONFIG, type ServerConfig } from '@/config'

/**
 * The slice of `fetch` the Anthropic client takes, injected so tests answer
 * for Claude and never touch the network.
 */
export type AiFetch = NonNullable<ClientOptions['fetch']>

/** The DI token the fetch is provided under. */
export const AI_FETCH = Symbol('AI_FETCH')

const API = 'https://api.anthropic.com'

/** One request may take this long; a lookup's replies are short. */
const TIMEOUT_MS = 60_000

/** The AI lookup could not ask: no key, a refused key, or Anthropic away. */
export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

export type AiState = { state: 'off' | 'ok' | 'failing'; error: string | null }

/** Today in UTC, when the day's count starts again, as OMDb's does. */
const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * Claude, through Anthropic's SDK, with raven's own key and nothing else
 * from the environment: no auth token, no profile, no base URL. Counts the
 * day's lookups against `AI_DAILY_LIMIT`, starting again at midnight UTC,
 * and stops for good, until a restart, once the key is refused.
 */
@Injectable()
export class AiClient {
  private readonly client: Anthropic | null
  private readonly budget = { day: today(), used: 0 }
  private readonly status: { error: string | null; refused: boolean } = {
    error: null,
    refused: false,
  }

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AI_FETCH) fetch: AiFetch,
  ) {
    const apiKey = config.anthropicApiKey
    this.client =
      apiKey == null
        ? null
        : new Anthropic({
            apiKey,
            authToken: null,
            baseURL: API,
            fetch,
            timeout: TIMEOUT_MS,
            logLevel: 'off',
          })
  }

  private usedToday(): number {
    if (this.budget.day !== today()) {
      this.budget.day = today()
      this.budget.used = 0
    }
    return this.budget.used
  }

  /** Whether there is a key, it was not refused, and today's lookups are not spent. */
  get enabled(): boolean {
    return (
      this.client != null && !this.status.refused && this.usedToday() < this.config.aiDailyLimit
    )
  }

  /** Lookups left today; none while the lookup is off. */
  remaining(): number {
    return this.client == null ? 0 : Math.max(0, this.config.aiDailyLimit - this.usedToday())
  }

  /** Books one of today's lookups; false once they are spent, or while the lookup is off. */
  take(): boolean {
    if (!this.enabled) return false
    this.budget.used += 1
    return true
  }

  state(): AiState {
    if (this.client == null) return { state: 'off', error: null }
    return { state: this.status.error == null ? 'ok' : 'failing', error: this.status.error }
  }

  /** One request to Claude. Failing throws an `AiError` whose message never holds the key. */
  async send(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    const { client } = this
    if (client == null || this.status.refused) throw new AiError('The AI lookup is off.')
    try {
      const message = await client.messages.create(params)
      this.status.error = null
      return message
    } catch (error) {
      const reason = this.failure(error)
      this.status.error = reason
      throw new AiError(reason)
    }
  }

  /** Why a request failed, in words that never hold the key; a refused key stops lookups for good. */
  private failure(error: unknown): string {
    if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
      this.status.refused = true
      return `Anthropic refused the key (${error.status}). Check ANTHROPIC_API_KEY and restart.`
    }
    if (error instanceof APIError && error.status != null) {
      return `Anthropic answered ${error.status}.`
    }
    return 'Anthropic could not be reached.'
  }
}
```

- [ ] **Step 10: Provide the fetch and the client**

In `apps/raven/server/src/appModule.ts`:

Add the import:

```ts
import { AI_FETCH, type AiFetch, AiClient } from '@/metadata/aiClient'
```

Change `register`'s parameters to take `aiFetch`:

```ts
  static register({
    config,
    metadataFetch = (url, init) => fetch(url, init),
    aiFetch = (input, init) => fetch(input, init),
    watch = {},
  }: {
    config: ServerConfig
    metadataFetch?: MetadataFetch
    aiFetch?: AiFetch
    watch?: Partial<WatchOptions>
  }): DynamicModule {
```

Add to `providers`, after `{ provide: METADATA_FETCH, useValue: metadataFetch },`:

```ts
        { provide: AI_FETCH, useValue: aiFetch },
```

and after `OmdbClient,`:

```ts
        AiClient,
```

Update the module comment's sentence `the fetch metadata uses so a test can answer for TMDB` to `the fetches metadata and the AI lookup use so a test can answer for TMDB and Claude`.

In `apps/raven/server/src/app.ts`, add `import type { AiFetch } from '@/metadata/aiClient'`, a parameter after `metadataFetch`:

```ts
  /** Stands in for Claude in tests; left out, AI lookups go to the network. */
  aiFetch?: AiFetch
```

with `aiFetch` destructured beside `metadataFetch`, and pass it on: `AppModule.register({ config, metadataFetch, aiFetch, watch })`.

- [ ] **Step 11: Run the tests and the typecheck**

Run: `bunx nx run @raven/server:test -- src/metadata/aiClient.test.ts src/config.test.ts` then `bunx nx run @raven/server:typecheck`
Expected: PASS.

- [ ] **Step 12: Document the variables**

In `apps/raven/.env.example`, after `OMDB_DAILY_LIMIT=1000` and before `# --- Privacy ---`, add:

```
# --- AI lookup ---
# raven's own Anthropic API key (console.anthropic.com), not one shared with
# other tools. With it, each show folder or movie the matcher leaves
# unmatched gets one lookup over TMDB's results: a sure pick matches the
# files, an unsure one is suggested under Not matched. The file and folder
# names of Movies, TV, Anime, Family and Documentaries libraries are sent to
# Anthropic; Sporting events, YouTube videos and Other libraries never are.
ANTHROPIC_API_KEY=
# The model the lookup asks.
AI_MATCH_MODEL=claude-haiku-5-5
# How hard it thinks: low, medium, high, xhigh or max.
AI_MATCH_EFFORT=low
# How many lookups raven makes a day before waiting for midnight UTC.
AI_DAILY_LIMIT=200
```

In `apps/raven/README.md`'s Configuration table, after the `OMDB_DAILY_LIMIT` row, add:

```
| `ANTHROPIC_API_KEY`           | unset                          | raven's own Anthropic key, for the [AI lookup](#metadata) of what matching leaves; unset turns it off |
| `AI_MATCH_MODEL`              | `claude-haiku-5-5`             | The model the AI lookup asks                 |
| `AI_MATCH_EFFORT`             | `low`                          | How hard it thinks: `low`, `medium`, `high`, `xhigh` or `max` |
| `AI_DAILY_LIMIT`              | `200`                          | AI lookups a day                             |
```

- [ ] **Step 13: Commit**

```bash
git add apps/raven/server/package.json bun.lock apps/raven/server/src/config.ts apps/raven/server/src/config.test.ts apps/raven/server/src/metadata/aiClient.ts apps/raven/server/src/metadata/aiClient.test.ts apps/raven/server/src/test/fakeClaude.ts apps/raven/server/src/app.ts apps/raven/server/src/appModule.ts apps/raven/.env.example apps/raven/README.md
git commit -m "$(cat <<'EOF'
MAE: raven reads the AI lookup's key and settings, and counts its day

- Four variables: the key, the model, the effort and a daily limit
- `AiClient` sends with raven's own key only, through a fetch injected under `AI_FETCH`
- A refused key stops lookups until a restart; a test fake stands in for the API
EOF
)"
```

---

### Task 2: `ai_decisions` and its storage

**Files:**
- Modify: `apps/raven/server/src/db/database.ts` (append migration 20)
- Modify: `apps/raven/server/src/db/database.test.ts`
- Create: `apps/raven/server/src/metadata/aiDecisions.ts`
- Create: `apps/raven/server/src/metadata/aiDecisions.test.ts`
- Modify: `apps/raven/server/src/appModule.ts`

**Interfaces:**
- Consumes: `DatabaseService`; `oneOf`, `Infer` from `@raven/core`. Until Task 5 adds core's `AiSuggestion`, `suggestionsAt` answers a local `Suggestion` type with the same fields.
- Produces:
  - `isAiConfidence = oneOf(['high', 'low'])`, `type AiConfidence`
  - `type AiPick = { tmdbId: string; title: string; year: number | null; poster: string | null }`
  - `type AiOutcome = { kind: 'chosen'; pick: AiPick; confidence: AiConfidence; reason: string } | { kind: 'none'; confidence: AiConfidence; reason: string } | { kind: 'undecided'; reason: string }`
  - `type DecisionPlace = { libraryId: number; place: string }`
  - `class AiDecisions`: `record(args: DecisionPlace & { outcome: AiOutcome; model: string }): void`, `isAsked(at: DecisionPlace): boolean`, `highPickAt(at: DecisionPlace): string | null`, `suggestionsAt({ libraryId, places }: { libraryId: number; places: readonly string[] }): Map<string, Suggestion>`, `highReason({ places, tmdbId }: { places: readonly DecisionPlace[]; tmdbId: string }): string | null`, `clearUndecided(libraryId: number): number`, `forget(libraryId: number): void`

- [ ] **Step 1: Write the failing migration test**

Append inside `describe('migrations', ...)` in `apps/raven/server/src/db/database.test.ts`:

```ts
  it("adds the AI lookup's decisions, none yet, gone with their library", () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 19).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 19')
    before.exec(
      "INSERT INTO libraries (name, created_at) VALUES ('TV', '2026-01-01T00:00:00.000Z')",
    )
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    const count = () => database.db.prepare('SELECT COUNT(*) AS decisions FROM ai_decisions').get()
    expect(count()).toEqual({ decisions: 0 })
    database.db
      .prepare(
        `INSERT INTO ai_decisions (library_id, place, tmdb_id, title, year, poster, confidence, reason, model, decided_at)
         VALUES (1, 'Archie', NULL, NULL, NULL, NULL, 'low', 'Nothing fits.', 'claude-haiku-5-5', '2026-10-13T00:00:00.000Z')`,
      )
      .run()
    expect(count()).toEqual({ decisions: 1 })
    database.db.prepare('DELETE FROM libraries WHERE id = 1').run()
    expect(count()).toEqual({ decisions: 0 })
    database.onModuleDestroy()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx nx run @raven/server:test -- src/db/database.test.ts`
Expected: FAIL, `no such table: ai_decisions`.

- [ ] **Step 3: Append migration 20**

At the end of `MIGRATIONS` in `apps/raven/server/src/db/database.ts`, after the folder layout entry:

```ts
  // What the AI lookup decided for each group it was asked about, by place
  // as a Fix match is kept: the TMDB id it chose (NULL when it chose nothing
  // or ended without a choice), that result's title, year and poster for the
  // Not matched suggestion, how sure it was, and why. A group with a row is
  // never asked again; Match again clears the rows with no id.
  `
  CREATE TABLE ai_decisions (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    place TEXT NOT NULL,
    tmdb_id TEXT,
    title TEXT,
    year INTEGER,
    poster TEXT,
    confidence TEXT NOT NULL,
    reason TEXT NOT NULL,
    model TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    PRIMARY KEY (library_id, place)
  );
  `,
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx nx run @raven/server:test -- src/db/database.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing storage tests**

Create `apps/raven/server/src/metadata/aiDecisions.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { type AiOutcome, AiDecisions } from '@/metadata/aiDecisions'
import { testDatabase } from '@/test/database'

const MODEL = 'claude-haiku-5-5'

const ARCHIE = {
  tmdbId: '201000',
  title: 'Archie: The Man Who Became Cary Grant',
  year: 2023,
  poster: '/archie.jpg',
}

describe("the AI lookup's decisions", () => {
  const database = testDatabase('raven-ai-decisions-')
  const state = { library: 0, other: 0 }
  const decisions = () => new AiDecisions(database.get())
  const record = ({
    place,
    outcome,
    libraryId = state.library,
  }: {
    place: string
    outcome: AiOutcome
    libraryId?: number
  }) => decisions().record({ libraryId, place, outcome, model: MODEL })

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.library = libraries.create({ name: 'TV', paths: ['/tv'], settings: { kind: 'shows' } }).id
    state.other = libraries.create({
      name: 'Anime',
      paths: ['/anime'],
      settings: { kind: 'animeShows' },
    }).id
  })

  afterAll(database.close)

  it('keeps one decision a place, the last, and says the place was asked', () => {
    expect(decisions().isAsked({ libraryId: state.library, place: 'Archie' })).toBe(false)
    record({ place: 'Archie', outcome: { kind: 'undecided', reason: 'No choice in 6 turns.' } })
    record({
      place: 'Archie',
      outcome: { kind: 'chosen', pick: ARCHIE, confidence: 'low', reason: 'Generic episode titles.' },
    })
    expect(decisions().isAsked({ libraryId: state.library, place: 'Archie' })).toBe(true)
    expect(decisions().isAsked({ libraryId: state.other, place: 'Archie' })).toBe(false)
    expect(
      database
        .get()
        .db.prepare('SELECT place, tmdb_id, confidence, model FROM ai_decisions WHERE library_id = ?')
        .all(state.library),
    ).toEqual([{ place: 'Archie', tmdb_id: '201000', confidence: 'low', model: MODEL }])
  })

  it('gives matching only a sure pick', () => {
    record({
      place: 'Destination Wild Arctic',
      outcome: {
        kind: 'chosen',
        pick: { tmdbId: '80001', title: 'Wild Arctic', year: 2018, poster: null },
        confidence: 'high',
        reason: 'Episode titles match.',
      },
    })
    record({
      place: 'Cesar 911',
      outcome: { kind: 'none', confidence: 'high', reason: 'Episodes of another show.' },
    })
    const pickAt = (place: string) => decisions().highPickAt({ libraryId: state.library, place })
    expect([
      pickAt('Destination Wild Arctic'),
      pickAt('Archie'),
      pickAt('Cesar 911'),
      pickAt('Nowhere'),
    ]).toEqual(['80001', null, null, null])
  })

  it('offers an unsure pick as a suggestion, by place', () => {
    const suggestions = decisions().suggestionsAt({
      libraryId: state.library,
      places: ['Archie', 'Destination Wild Arctic', 'Cesar 911', 'Archie'],
    })
    expect([...suggestions]).toEqual([
      ['Archie', { ...ARCHIE, reason: 'Generic episode titles.' }],
    ])
    expect(decisions().suggestionsAt({ libraryId: state.library, places: [] }).size).toBe(0)
  })

  it("says why a sure pick matched, for an item's places and id", () => {
    const reason = ({ places, tmdbId }: { places: string[]; tmdbId: string }) =>
      decisions().highReason({
        places: places.map((place) => ({ libraryId: state.library, place })),
        tmdbId,
      })
    expect(reason({ places: ['Destination Wild Arctic'], tmdbId: '80001' })).toBe(
      'Episode titles match.',
    )
    expect(reason({ places: ['Destination Wild Arctic'], tmdbId: '99' })).toBeNull()
    expect(reason({ places: ['Archie'], tmdbId: '201000' })).toBeNull()
    expect(reason({ places: [], tmdbId: '80001' })).toBeNull()
  })

  it('clears what came to nothing for Match again, forgets a library, and goes with it', () => {
    expect(decisions().clearUndecided(state.library)).toBe(1)
    expect(decisions().isAsked({ libraryId: state.library, place: 'Cesar 911' })).toBe(false)
    expect(decisions().isAsked({ libraryId: state.library, place: 'Archie' })).toBe(true)
    record({
      libraryId: state.other,
      place: 'Bebop',
      outcome: { kind: 'undecided', reason: 'Declined.' },
    })
    decisions().forget(state.library)
    expect(decisions().isAsked({ libraryId: state.library, place: 'Archie' })).toBe(false)
    expect(decisions().isAsked({ libraryId: state.other, place: 'Bebop' })).toBe(true)
    new LibrariesRepository(database.get()).remove(state.other)
    expect(decisions().isAsked({ libraryId: state.other, place: 'Bebop' })).toBe(false)
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/metadata/aiDecisions.test.ts`
Expected: FAIL, `Cannot find module '@/metadata/aiDecisions'`.

- [ ] **Step 7: Write the storage**

Create `apps/raven/server/src/metadata/aiDecisions.ts`. `Suggestion` is written out here; Task 5 replaces it with core's `AiSuggestion`, which has the same fields.

```ts
import { Inject, Injectable } from '@nestjs/common'
import { type Infer, oneOf } from '@raven/core'
import { DatabaseService } from '@/db/database'

/** How sure the AI lookup was: `high` is matched, `low` is a suggestion. */
export const isAiConfidence = oneOf(['high', 'low'])

export type AiConfidence = Infer<typeof isAiConfidence>

/** The movie or show the AI lookup chose, as the search that offered it described it. */
export type AiPick = { tmdbId: string; title: string; year: number | null; poster: string | null }

/** How one lookup came out. */
export type AiOutcome =
  /** Claude chose a result `search_tmdb` offered in the lookup. */
  | { kind: 'chosen'; pick: AiPick; confidence: AiConfidence; reason: string }
  /** Claude chose nothing: no result fits, or the files are another show's. */
  | { kind: 'none'; confidence: AiConfidence; reason: string }
  /** No decision: a refusal, no `choose_match`, an id never offered, or out of turns. */
  | { kind: 'undecided'; reason: string }

/** Where a decision is kept: a group's place in a library, as a Fix match is. */
export type DecisionPlace = { libraryId: number; place: string }

/** An unsure pick, as the Not matched listing offers it. */
type Suggestion = AiPick & { reason: string }

/** A decision as its columns hold it. */
type Row = {
  tmdbId: string | null
  title: string | null
  year: number | null
  poster: string | null
  confidence: AiConfidence
  reason: string
}

/** How an outcome is kept: one with no decision counts as low, with no id. */
const rowOf = (outcome: AiOutcome): Row => {
  switch (outcome.kind) {
    case 'chosen':
      return { ...outcome.pick, confidence: outcome.confidence, reason: outcome.reason }
    case 'none':
      return {
        tmdbId: null,
        title: null,
        year: null,
        poster: null,
        confidence: outcome.confidence,
        reason: outcome.reason,
      }
    case 'undecided':
      return {
        tmdbId: null,
        title: null,
        year: null,
        poster: null,
        confidence: 'low',
        reason: outcome.reason,
      }
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

/**
 * What the AI lookup decided for each group it was asked about, by library
 * and place, so a group is asked once. A sure pick is matched; an unsure
 * one is a suggestion; no pick is asked again after Match again.
 */
@Injectable()
export class AiDecisions {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** Keeps a lookup's outcome for its place, replacing the one before. */
  record({
    libraryId,
    place,
    outcome,
    model,
  }: DecisionPlace & { outcome: AiOutcome; model: string }): void {
    const row = rowOf(outcome)
    this.db
      .prepare(
        `INSERT INTO ai_decisions
           (library_id, place, tmdb_id, title, year, poster, confidence, reason, model, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (library_id, place) DO UPDATE SET
           tmdb_id = excluded.tmdb_id, title = excluded.title, year = excluded.year,
           poster = excluded.poster, confidence = excluded.confidence, reason = excluded.reason,
           model = excluded.model, decided_at = excluded.decided_at`,
      )
      .run(
        libraryId,
        place,
        row.tmdbId,
        row.title,
        row.year,
        row.poster,
        row.confidence,
        row.reason,
        model,
        new Date().toISOString(),
      )
  }

  /** Whether a place was asked about, whatever came of it. */
  isAsked({ libraryId, place }: DecisionPlace): boolean {
    return (
      this.db
        .prepare<[number, string], { found: number }>(
          'SELECT 1 AS found FROM ai_decisions WHERE library_id = ? AND place = ?',
        )
        .get(libraryId, place) != null
    )
  }

  /** The TMDB id of a sure pick for a place, which matching takes after its own search. */
  highPickAt({ libraryId, place }: DecisionPlace): string | null {
    return (
      this.db
        .prepare<[number, string], { tmdb_id: string }>(
          `SELECT tmdb_id FROM ai_decisions
            WHERE library_id = ? AND place = ? AND confidence = 'high' AND tmdb_id IS NOT NULL`,
        )
        .get(libraryId, place)?.tmdb_id ?? null
    )
  }

  /** The unsure picks for these places, by place. */
  suggestionsAt({
    libraryId,
    places,
  }: {
    libraryId: number
    places: readonly string[]
  }): Map<string, Suggestion> {
    if (places.length === 0) return new Map()
    const rows = this.db
      .prepare<
        [number, string],
        {
          place: string
          tmdb_id: string
          title: string | null
          year: number | null
          poster: string | null
          reason: string
        }
      >(
        `SELECT place, tmdb_id, title, year, poster, reason FROM ai_decisions
          WHERE library_id = ? AND confidence = 'low' AND tmdb_id IS NOT NULL
            AND place IN (SELECT value FROM json_each(?))`,
      )
      .all(libraryId, JSON.stringify([...new Set(places)]))
    return new Map(
      rows.flatMap((row) =>
        row.title == null
          ? []
          : [
              [
                row.place,
                {
                  tmdbId: row.tmdb_id,
                  title: row.title,
                  year: row.year,
                  poster: row.poster,
                  reason: row.reason,
                },
              ] as const,
            ],
      ),
    )
  }

  /** The reason of the newest sure pick of `tmdbId` at any of `places`; null when none chose it. */
  highReason({
    places,
    tmdbId,
  }: {
    places: readonly DecisionPlace[]
    tmdbId: string
  }): string | null {
    if (places.length === 0) return null
    return (
      this.db
        .prepare<[string, string], { reason: string }>(
          `SELECT d.reason FROM ai_decisions d
             JOIN json_each(?) p
               ON d.library_id = json_extract(p.value, '$.libraryId')
              AND d.place = json_extract(p.value, '$.place')
            WHERE d.tmdb_id = ? AND d.confidence = 'high'
            ORDER BY d.decided_at DESC
            LIMIT 1`,
        )
        .get(JSON.stringify(places), tmdbId)?.reason ?? null
    )
  }

  /** Match again: the lookups that chose no id are forgotten, so their groups are asked again. How many. */
  clearUndecided(libraryId: number): number {
    return Number(
      this.db
        .prepare<[number]>('DELETE FROM ai_decisions WHERE library_id = ? AND tmdb_id IS NULL')
        .run(libraryId).changes,
    )
  }

  /** Every decision of a library, for a change that makes them stale: its type, or where its files sit. */
  forget(libraryId: number): void {
    this.db.prepare('DELETE FROM ai_decisions WHERE library_id = ?').run(libraryId)
  }
}
```

Add `AiDecisions` to the providers in `appModule.ts`, after `MatchFiles,`, with `import { AiDecisions } from '@/metadata/aiDecisions'`.

- [ ] **Step 8: Run them to verify they pass**

Run: `bunx nx run @raven/server:test -- src/metadata/aiDecisions.test.ts src/db/database.test.ts` then `bunx nx run @raven/server:typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/raven/server/src/db/database.ts apps/raven/server/src/db/database.test.ts apps/raven/server/src/metadata/aiDecisions.ts apps/raven/server/src/metadata/aiDecisions.test.ts apps/raven/server/src/appModule.ts
git commit -m "$(cat <<'EOF'
MAE: raven keeps what the AI lookup decided for each group

- Migration 20 adds `ai_decisions`, by library and place, gone with its library
- `AiDecisions` keeps a pick with its title, year and poster, or none
- A sure pick is for matching, an unsure one a suggestion; Match again clears the rest
EOF
)"
```

---

### Task 3: The lookup: prompt, tools and the loop

**Files:**
- Create: `apps/raven/server/src/metadata/aiTools.ts`
- Create: `apps/raven/server/src/metadata/aiMatcher.ts`
- Create: `apps/raven/server/src/metadata/aiMatcher.test.ts`
- Modify: `apps/raven/server/src/metadata/matchers.ts` (export the search titles; no change in behaviour)
- Modify: `apps/raven/server/src/appModule.ts`

**Interfaces:**
- Consumes: `AiClient`, `AiError` (Task 1); `isAiConfidence`, `AiOutcome`, `AiPick` (Task 2); `SearchResult.genreIds` and `originalLanguage` (step 3); `TmdbClient.searchMovies`, `searchShows`, `season`; `notFound` from `@/metadata/matchPass`; `fakeClaude` (Task 1); `fakeTmdb` with `FakeShow.genreIds`, `language`, `countries` (step 3).
- Produces:
  - `readShowFile(first: MatchFile): ParsedEpisodeName`, `showSearchTitles(parsed: ParsedEpisodeName): SearchTitle[]`, `movieSearchTitles({ file, parsed }: { file: Pick<MatchFile, 'title' | 'year'>; parsed: ParsedMovieName }): SearchTitle[]` (in `matchers.ts`)
  - `AI_SYSTEM_PROMPT: string`, `AI_TOOLS: Anthropic.Tool[]`, `AI_TOOL_NAMES`, `isSearchInput`, `isEpisodesInput`, `isChooseInput`, `type AiGroup`, `askFor(group: AiGroup): string`, `describeCandidate(result: SearchResult)` (in `aiTools.ts`)
  - `AI_FILE_SAMPLE = 12`, `AI_CONCURRENCY = 2`, `AI_MAX_TURNS = 6`, `aiGroupOf({ library, type, place, files }): AiGroup`, `class AiMatcher` with `model: string` (getter) and `decide(group: AiGroup): Promise<AiOutcome>` (in `aiMatcher.ts`)

- [ ] **Step 1: Export what matching searches by**

In `apps/raven/server/src/metadata/matchers.ts`:

Change the core import to:

```ts
import {
  isExtra,
  type MatchItemType,
  type MatchState,
  type ParsedEpisodeName,
  type ParsedMovieName,
  parseEpisodeName,
  parseMovieName,
  showFolderOf,
} from '@raven/core'
```

and `import type { MatchPass } from '@/metadata/matchPass'` to `import type { MatchPass, SearchTitle } from '@/metadata/matchPass'`.

After `withoutExtras`, add:

```ts
/** A show folder's first file as matching reads it: a file at a root falls back to the folder its titles sit in. */
export const readShowFile = (first: MatchFile): ParsedEpisodeName =>
  parseEpisodeName({ ...first, fallbackShow: basename(rootOf(first)) })

/**
 * The titles a show folder is searched by, in turn: the folder's name; the
 * file's own, as a folder is misspelt more often than every file; and the
 * folder's without an annotation that reads as an edition, as shows have
 * none: "Dragon Ball Z (Uncut)".
 */
export const showSearchTitles = (parsed: ParsedEpisodeName): SearchTitle[] => {
  const narrowing = { year: parsed.year, country: parsed.country }
  return [
    { title: parsed.show, ...narrowing },
    ...(parsed.showFromFile == null ? [] : [{ title: parsed.showFromFile, ...narrowing }]),
    ...(parsed.showWithoutEdition == null
      ? []
      : [{ title: parsed.showWithoutEdition, ...narrowing }]),
  ]
}

/**
 * The titles a movie file is searched by, in turn: its name's title and
 * year, then the name's other readings, such as the file's own name where
 * its folder is misnamed.
 */
export const movieSearchTitles = ({
  file,
  parsed,
}: {
  file: Pick<MatchFile, 'title' | 'year'>
  parsed: ParsedMovieName
}): SearchTitle[] => [{ title: file.title, year: file.year }, ...parsed.alternatives]
```

In `matchMovie`, replace the `titles:` entry and the two comment lines above it with:

```ts
      titles: movieSearchTitles({ file, parsed }),
```

In `matchShowGroup`, replace

```ts
    const parsed = parseEpisodeName({ ...first, fallbackShow })
    const narrowing = { year: parsed.year, country: parsed.country }
```

with

```ts
    const parsed = readShowFile(first)
```

and replace the `titles: [ ... ],` entry (with its two comments) with:

```ts
      titles: showSearchTitles(parsed),
```

Run: `bunx nx run @raven/server:test -- src/metadata/matchers.test.ts src/metadata/shows.test.ts src/metadata/movies.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 2: Write the failing lookup tests**

Create `apps/raven/server/src/metadata/aiMatcher.test.ts`:

```ts
import { join } from 'node:path'
import { DEFAULT_LIBRARY_SETTINGS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import type { LibraryRecord } from '@/libraries/librariesRepository'
import { AiClient, AiError } from '@/metadata/aiClient'
import { aiGroupOf, AiMatcher } from '@/metadata/aiMatcher'
import { type AiGroup, AI_TOOL_NAMES } from '@/metadata/aiTools'
import type { MatchFile } from '@/metadata/matchFiles'
import { TmdbClient, TmdbError } from '@/metadata/tmdbClient'
import { type FakeReply, fakeClaude } from '@/test/fakeClaude'
import { fakeTmdb } from '@/test/fakeTmdb'

const config = {
  ...readServerConfig({}),
  tmdbApiToken: 'test-token',
  anthropicApiKey: 'test-key',
}

const WILD: AiGroup = {
  kind: 'shows',
  type: 'show',
  layout: 'flat',
  place: 'Destination Wild Arctic',
  fileCount: 2,
  fileNames: [
    'Season 1/Destination Wild Arctic - S01E01 - Polar Night.mp4',
    'Season 1/Destination Wild Arctic - S01E02 - The Thaw.mp4',
  ],
  parsed: { title: 'Destination Wild Arctic', year: null },
  tried: [{ title: 'Destination Wild Arctic', year: null }],
}

const SEARCH_WILD: FakeReply = { kind: 'search', type: 'show', query: 'Wild Arctic', year: null }

describe('AiMatcher', () => {
  const tmdb = fakeTmdb({
    movies: [{ id: 949, title: 'Heat', released: '1995-12-15' }],
    shows: [
      {
        id: 80001,
        title: 'Wild Arctic',
        first: '2018-01-07',
        genreIds: [99],
        countries: ['GB'],
        seasons: {
          1: [
            { number: 1, title: 'Polar Night', aired: '2018-01-07' },
            { number: 2, title: 'The Thaw', aired: '2018-01-14' },
          ],
        },
      },
    ],
  })

  const lookUp = async ({
    replies,
    status = 200,
  }: {
    replies: readonly FakeReply[]
    status?: number
  }) => {
    const claude = fakeClaude({ lookups: { [WILD.place]: replies } })
    claude.state.status = status
    const matcher = new AiMatcher(
      config,
      new AiClient(config, claude.fetch),
      new TmdbClient(config, tmdb.fetch),
    )
    const outcome = await matcher.decide(WILD)
    return { outcome, requests: claude.state.requests }
  }

  /** The tool results raven sent back on a request: its last message's content. */
  const resultsIn = (body: Record<string, unknown>): unknown =>
    (Array.isArray(body.messages) ? body.messages : []).at(-1)

  it('takes a show it checked episode by episode as a sure pick', async () => {
    const { outcome, requests } = await lookUp({
      replies: [
        SEARCH_WILD,
        { kind: 'episodes', tmdbId: '80001', season: 1 },
        {
          kind: 'choose',
          tmdbId: '80001',
          confidence: 'high',
          reason: "Season 1's episode titles match TMDB's.",
        },
      ],
    })
    expect(outcome).toEqual({
      kind: 'chosen',
      pick: { tmdbId: '80001', title: 'Wild Arctic', year: 2018, poster: '/showposter80001.jpg' },
      confidence: 'high',
      reason: "Season 1's episode titles match TMDB's.",
    })
    expect(requests).toHaveLength(3)
  })

  it('keeps a pick it could not confirm as unsure', async () => {
    const { outcome } = await lookUp({
      replies: [
        SEARCH_WILD,
        { kind: 'choose', tmdbId: '80001', confidence: 'low', reason: 'Generic titles.' },
      ],
    })
    expect(outcome).toMatchObject({ kind: 'chosen', confidence: 'low' })
  })

  it('chooses nothing when no result fits', async () => {
    const { outcome } = await lookUp({
      replies: [
        { kind: 'search', type: 'show', query: 'Cesar 911', year: null },
        { kind: 'choose', tmdbId: null, confidence: 'high', reason: 'No TMDB show fits.' },
      ],
    })
    expect(outcome).toEqual({ kind: 'none', confidence: 'high', reason: 'No TMDB show fits.' })
  })

  it('throws away an id no search in the lookup returned', async () => {
    const { outcome } = await lookUp({
      replies: [{ kind: 'choose', tmdbId: '80001', confidence: 'high', reason: 'I know it.' }],
    })
    expect(outcome).toMatchObject({ kind: 'undecided' })
  })

  it('throws away a movie id in a TV library, though a search returned it', async () => {
    const { outcome } = await lookUp({
      replies: [
        { kind: 'search', type: 'movie', query: 'Heat', year: null },
        { kind: 'choose', tmdbId: '949', confidence: 'high', reason: 'Heat.' },
      ],
    })
    expect(outcome).toMatchObject({ kind: 'undecided' })
  })

  it('takes a refusal as no decision', async () => {
    const { outcome, requests } = await lookUp({ replies: [{ kind: 'refuse' }] })
    expect(outcome).toMatchObject({ kind: 'undecided' })
    expect(requests).toHaveLength(1)
  })

  it('takes an end without choose_match as no decision', async () => {
    const { outcome } = await lookUp({
      replies: [SEARCH_WILD, { kind: 'say', text: 'Wild Arctic, I think.' }],
    })
    expect(outcome).toMatchObject({ kind: 'undecided' })
  })

  it('gives up after six replies without a choice', async () => {
    const { outcome, requests } = await lookUp({
      replies: Array.from({ length: 7 }, () => SEARCH_WILD),
    })
    expect(outcome).toEqual({ kind: 'undecided', reason: 'No choice in 6 turns.' })
    expect(requests).toHaveLength(6)
  })

  it('describes each result by id, titles, year, genres, language, countries and the start of its overview', async () => {
    const { requests } = await lookUp({
      replies: [SEARCH_WILD, { kind: 'choose', tmdbId: null, confidence: 'low', reason: 'x' }],
    })
    expect(resultsIn(requests[1]!.body)).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_0',
          content: JSON.stringify([
            {
              tmdbId: '80001',
              title: 'Wild Arctic',
              originalTitle: 'Wild Arctic',
              year: 2018,
              genres: ['Documentary'],
              language: 'en',
              countries: ['GB'],
              overview: 'Wild Arctic is a show.',
            },
          ]),
        },
      ],
    })
  })

  it("lists a season's episodes, says when TMDB has no such season, and lists only shows it offered", async () => {
    const { requests } = await lookUp({
      replies: [
        { kind: 'episodes', tmdbId: '80001', season: 1 },
        SEARCH_WILD,
        { kind: 'episodes', tmdbId: '80001', season: 2 },
        { kind: 'episodes', tmdbId: '80001', season: 1 },
        { kind: 'choose', tmdbId: null, confidence: 'low', reason: 'x' },
      ],
    })
    expect(resultsIn(requests[1]!.body)).toMatchObject({
      content: [
        {
          content: 'Show 80001 came from no search in this lookup; search for it first.',
          is_error: true,
        },
      ],
    })
    expect(resultsIn(requests[3]!.body)).toMatchObject({
      content: [{ content: 'TMDB lists no season 2 of show 80001.' }],
    })
    expect(resultsIn(requests[4]!.body)).toMatchObject({
      content: [
        {
          content: JSON.stringify({
            season: 1,
            episodes: [
              { number: 1, title: 'Polar Night' },
              { number: 2, title: 'The Thaw' },
            ],
          }),
        },
      ],
    })
  })

  it('refuses a tool call whose input does not fit, or a tool there is not', async () => {
    const { requests } = await lookUp({
      replies: [
        { kind: 'call', name: AI_TOOL_NAMES.search, input: { type: 'show', query: ' ', year: null } },
        { kind: 'call', name: 'delete_files', input: {} },
        { kind: 'choose', tmdbId: null, confidence: 'low', reason: 'x' },
      ],
    })
    expect(resultsIn(requests[1]!.body)).toMatchObject({ content: [{ is_error: true }] })
    expect(resultsIn(requests[2]!.body)).toMatchObject({
      content: [{ content: 'There is no tool called delete_files.', is_error: true }],
    })
  })

  it('asks as the spec sets: the model, low effort, adaptive thinking, strict tools, the prompt cached', async () => {
    const { requests } = await lookUp({ replies: [{ kind: 'refuse' }] })
    const [first] = requests
    expect(first?.apiKey).toBe('test-key')
    expect(first?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      tool_choice: { type: 'auto' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
      tools: [
        { name: 'search_tmdb', strict: true, input_schema: { additionalProperties: false } },
        { name: 'list_episodes', strict: true, input_schema: { additionalProperties: false } },
        { name: 'choose_match', strict: true, input_schema: { additionalProperties: false } },
      ],
    })
    // Each of these is a 400 on Haiku 5.5, and none belongs in a lookup.
    expect(first?.raw).not.toMatch(/budget_tokens|top_p|top_k|temperature|fallbacks/)
    expect(first?.body.messages).toEqual([
      { role: 'user', content: expect.stringMatching(/^Which TMDB show are these files\?\n\n\{/) },
    ])
  })

  it("keeps the conversation append-only, sending each reply back as it came, thinking and all", async () => {
    const { requests } = await lookUp({
      replies: [
        SEARCH_WILD,
        { kind: 'episodes', tmdbId: '80001', season: 1 },
        { kind: 'choose', tmdbId: '80001', confidence: 'high', reason: 'Titles match.' },
      ],
    })
    const messages = requests.map((request) =>
      Array.isArray(request.body.messages) ? request.body.messages : [],
    )
    expect(messages.map((each) => each.length)).toEqual([1, 3, 5])
    expect(messages[1]?.slice(0, 1)).toEqual(messages[0])
    expect(messages[2]?.slice(0, 3)).toEqual(messages[1])
    expect(messages[1]?.[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'signature-0' },
        {
          type: 'tool_use',
          id: 'toolu_0',
          name: 'search_tmdb',
          input: { type: 'show', query: 'Wild Arctic', year: null },
          caller: { type: 'direct' },
        },
      ],
    })
  })

  it('throws when TMDB is away, leaving the group to be asked again', async () => {
    tmdb.state.down = true
    try {
      await expect(lookUp({ replies: [SEARCH_WILD] })).rejects.toBeInstanceOf(TmdbError)
    } finally {
      tmdb.state.down = false
    }
  })

  it('throws when Anthropic is away', async () => {
    await expect(lookUp({ replies: [SEARCH_WILD], status: 529 })).rejects.toBeInstanceOf(AiError)
  })
})

describe('aiGroupOf', () => {
  const library = (kind: LibraryRecord['settings']['kind']): LibraryRecord => ({
    id: 1,
    name: 'TV',
    paths: ['/media/TV'],
    layouts: [{ path: '/media/TV', layout: 'lettered', groups: 0 }],
    itemCount: 0,
    unmatchedCount: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    settings: { ...DEFAULT_LIBRARY_SETTINGS, kind },
  })
  const file = ({
    id,
    folder,
    fileName,
    title = '',
    year = null,
  }: {
    id: number
    folder: string
    fileName: string
    title?: string
    year?: number | null
  }): MatchFile => ({
    id,
    libraryId: 1,
    path: join('/media/TV/D', folder, fileName),
    fileName,
    folder,
    title,
    year,
    match: 'unmatched',
  })

  it('describes a show folder by its place and 12 files spread over it, never a full path', () => {
    const files = [1, 2, 3].flatMap((season) =>
      Array.from({ length: 10 }, (_, index) => {
        const code = `S0${season}E${String(index + 1).padStart(2, '0')}`
        return file({
          id: season * 100 + index,
          folder: `Doctor Who (2023)/Season ${season}`,
          fileName: `Doctor Who - ${code} - Episode ${index + 1}.mkv`,
        })
      }),
    )
    const group = aiGroupOf({
      library: library('shows'),
      type: 'show',
      place: 'Doctor Who (2023)',
      files: files.toReversed(),
    })
    expect(group).toMatchObject({
      kind: 'shows',
      type: 'show',
      layout: 'lettered',
      place: 'Doctor Who (2023)',
      fileCount: 30,
      parsed: { title: 'Doctor Who', year: 2023 },
      tried: [{ title: 'Doctor Who', year: 2023 }],
    })
    expect(group.fileNames).toHaveLength(12)
    expect(group.fileNames[0]).toBe('Season 1/Doctor Who - S01E01 - Episode 1.mkv')
    expect(group.fileNames.at(-1)).toMatch(/^Season 3\//)
    expect(JSON.stringify(group)).not.toContain('/media')
  })

  it('describes a movie by its file, the title its name reads and the searches tried', () => {
    const movie = file({
      id: 1,
      folder: '25th Hour (2002)',
      fileName: '25th.Hour.2002.1080p.mkv',
      title: '25th Hour',
      year: 2002,
    })
    const group = aiGroupOf({
      library: library('movies'),
      type: 'movie',
      place: '25th Hour (2002)',
      files: [movie],
    })
    expect(group).toMatchObject({
      type: 'movie',
      fileCount: 1,
      fileNames: ['25th.Hour.2002.1080p.mkv'],
      parsed: { title: '25th Hour', year: 2002 },
    })
    expect(group.tried[0]).toEqual({ title: '25th Hour', year: 2002 })
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/metadata/aiMatcher.test.ts`
Expected: FAIL, `Cannot find module '@/metadata/aiMatcher'`.

- [ ] **Step 4: Write the prompt and the tools**

Create `apps/raven/server/src/metadata/aiTools.ts`:

```ts
import type { Anthropic } from '@anthropic-ai/sdk'
import {
  isMatchItemType,
  isNumber,
  isString,
  isTmdbId,
  type LibraryKind,
  type MatchItemType,
  nullable,
  object,
  type PathLayout,
} from '@raven/core'
import { isAiConfidence } from '@/metadata/aiDecisions'
import type { SearchResult } from '@/metadata/tmdbClient'

/**
 * What the AI lookup is told of a group left unmatched: never a path
 * outside the library.
 */
export type AiGroup = {
  kind: LibraryKind
  type: MatchItemType
  /** How the path the files sit in was read; null before its first full scan. */
  layout: PathLayout | null
  /** The group's place inside the folder its titles sit in: `Doctor Who (2023)`, or a loose file's name. */
  place: string
  fileCount: number
  /** Some of its files, each as its path inside the place, spread over the group. */
  fileNames: string[]
  /** The show (for a movie, its title) and year raven read from the names. */
  parsed: { title: string; year: number | null }
  /** The searches matching ran, which found nothing it was sure of. */
  tried: Array<{ title: string; year: number | null }>
}

export const AI_TOOL_NAMES = {
  search: 'search_tmdb',
  episodes: 'list_episodes',
  choose: 'choose_match',
} as const

/** How many results one search hands Claude. */
export const AI_SEARCH_RESULTS = 10

/** How much of a result's overview Claude reads, in characters. */
const OVERVIEW_LENGTH = 200

/** A whole number: a year, a season. */
const isWhole = (value: unknown): value is number => isNumber(value) && Number.isInteger(value)

/** Words, not only spaces. */
const isText = (value: unknown): value is string => isString(value) && value.trim() !== ''

/** What `search_tmdb` takes; strict tool use guarantees the shape, and this checks it anyway. */
export const isSearchInput = object({ type: isMatchItemType, query: isText, year: nullable(isWhole) })

export const isEpisodesInput = object({ tmdbId: isTmdbId, season: isWhole })

export const isChooseInput = object({
  tmdbId: nullable(isTmdbId),
  confidence: isAiConfidence,
  reason: isText,
})

/**
 * The lookup's instructions. They never change, so every lookup reads them
 * and the tools from the prompt cache; anything about one group goes in its
 * first message instead.
 */
export const AI_SYSTEM_PROMPT = `You find which TMDB movie or show a group of video files in someone's home media library is. raven, the media server, matched the library's other files to TMDB by name; it could not match this group with certainty, so it asks you. What you choose with high confidence is applied without review. What you choose with low confidence is shown to the owner as a suggestion to accept or reject. A wrong high answer mislabels their library; a careful low one costs them a click.

You are given, as JSON:
- library: the type of library, and the results it prefers.
- layout: how the library's folders are read.
- place: the group's folder inside the library, or the file's own name when it has no folder.
- files: how many files the group holds, and up to 12 of their paths inside the place, spread across it.
- parsed: the title (for a show, the show's name) and year raven read from the names.
- tried: the searches raven ran, by title and year, which found nothing it was sure of.

How to work:
1. Search with search_tmdb: for movies in a movie library, for shows in a TV library. Try what raven did not: the title without a year, since a folder's year is often wrong or belongs to a remake; the title as the files spell it when the folder is misspelt; an original, shorter or longer title.
2. For a show, call list_episodes on each candidate you are weighing, for a season the files hold, and compare the episode numbers and titles in the file names with TMDB's. That is how you tell apart shows that share a name: a series and its revival, an anime and its live action remake.
3. Call choose_match once, as your last step. You get at most six replies, and one reply may call several tools at once.

Confidence:
- high: the title fits, and for a show the files' episode titles match the candidate's in the season you listed; for a movie, the title and year fit and no other result fits as well. Never answer high for a show you did not check with list_episodes.
- low: a candidate you could not confirm. The episode titles in the names are generic (Episode 1, Part 2) or missing, the files hold a season TMDB does not list, or two results fit equally well.
- No match: choose a tmdbId of null when no result fits, or when the files are really episodes of a different show from the one the folder names. Say which in the reason.

Rules:
- Only choose an id search_tmdb returned in this lookup, of the library's type.
- The reason is one or two plain sentences the owner can check, naming what decided it: "Season 1's episode titles match TMDB's (Polar Night, The Thaw)."
- Nobody answers questions here: decide with what the tools give you.`

/** The three tools, strict, so each call's input fits its schema. */
export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: AI_TOOL_NAMES.search,
    description:
      "Searches TMDB for movies or shows by title, as raven's matcher does, and returns up to 10 results: each one's TMDB id, title, original title, year, genres, original language, countries of origin (shows only) and the start of its overview. A year keeps to results from that year, a show's by its first air date; null searches every year.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...isMatchItemType.values], description: 'movie or show.' },
        query: { type: 'string', description: 'The title to search for.' },
        year: {
          anyOf: [{ type: 'integer' }, { type: 'null' }],
          description: 'The year to keep to, or null for any.',
        },
      },
      required: ['type', 'query', 'year'],
      additionalProperties: false,
    },
  },
  {
    name: AI_TOOL_NAMES.episodes,
    description:
      "Lists a season's episodes as TMDB has them, each with its number and title, for a show search_tmdb returned in this lookup. Compare them with the episode codes and titles in the file names.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tmdbId: { type: 'string', description: "The show's TMDB id, from search_tmdb." },
        season: { type: 'integer', description: 'The season number; 0 is Specials.' },
      },
      required: ['tmdbId', 'season'],
      additionalProperties: false,
    },
  },
  {
    name: AI_TOOL_NAMES.choose,
    description: 'Gives your answer and ends the lookup. Call it once, last.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tmdbId: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description:
            'The TMDB id of the movie or show the files are, from search_tmdb; null when none fits.',
        },
        confidence: {
          type: 'string',
          enum: [...isAiConfidence.values],
          description: 'high when you checked it, low when a person should look at it.',
        },
        reason: {
          type: 'string',
          description: 'One or two plain sentences on what decided it, for the owner to read.',
        },
      },
      required: ['tmdbId', 'confidence', 'reason'],
      additionalProperties: false,
    },
  },
]

/** What each type of library is, as Claude is told. Sporting events, YouTube videos and Other are never asked about. */
const LIBRARY_WORDS = {
  movies: 'Movies',
  shows: 'TV shows',
  animeMovies: 'Anime movies: Japanese animation first, then any animation',
  animeShows: 'Anime shows: Japanese animation first, then any animation',
  familyMovies: 'Family movies: family films and animation first',
  familyShows: 'Family TV shows: family shows and animation first',
  documentaries: 'Documentaries: documentaries first, matched as movies',
  sports: 'Sporting events',
  youtube: 'YouTube videos',
  other: 'Other',
} as const satisfies Record<LibraryKind, string>

const LAYOUT_WORDS = {
  flat: 'one folder per title',
  lettered: 'letter folders (A, B, #) that hold the titles',
  grouped: 'group folders (such as Requests) that hold the titles',
  unread: 'not read yet',
} as const satisfies Record<PathLayout | 'unread', string>

/** TMDB's genre names, movies' and shows' together: a search gives only ids. */
const GENRE_NAMES = new Map<number, string>([
  [28, 'Action'],
  [12, 'Adventure'],
  [16, 'Animation'],
  [35, 'Comedy'],
  [80, 'Crime'],
  [99, 'Documentary'],
  [18, 'Drama'],
  [10751, 'Family'],
  [14, 'Fantasy'],
  [36, 'History'],
  [27, 'Horror'],
  [10402, 'Music'],
  [9648, 'Mystery'],
  [10749, 'Romance'],
  [878, 'Science Fiction'],
  [10770, 'TV Movie'],
  [53, 'Thriller'],
  [10752, 'War'],
  [37, 'Western'],
  [10759, 'Action & Adventure'],
  [10762, 'Kids'],
  [10763, 'News'],
  [10764, 'Reality'],
  [10765, 'Sci-Fi & Fantasy'],
  [10766, 'Soap'],
  [10767, 'Talk'],
  [10768, 'War & Politics'],
])

/** One search result as Claude reads it. */
export const describeCandidate = (result: SearchResult) => ({
  tmdbId: result.tmdbId,
  title: result.title,
  originalTitle: result.originalTitle,
  year: result.year,
  genres: result.genreIds.map((id) => GENRE_NAMES.get(id) ?? `genre ${id}`),
  language: result.originalLanguage,
  countries: result.countries,
  overview: result.overview?.slice(0, OVERVIEW_LENGTH) ?? null,
})

/** The facts of a group, as its lookup's first message gives them. */
const factsOf = (group: AiGroup) => ({
  library: LIBRARY_WORDS[group.kind],
  layout: LAYOUT_WORDS[group.layout ?? 'unread'],
  place: group.place,
  files: { count: group.fileCount, names: group.fileNames },
  parsed:
    group.type === 'show'
      ? { show: group.parsed.title, year: group.parsed.year }
      : { title: group.parsed.title, year: group.parsed.year },
  tried: group.tried,
})

/** A lookup's first message: the question, then the group's facts as JSON. */
export const askFor = (group: AiGroup): string =>
  `Which TMDB ${group.type} are these files?\n\n${JSON.stringify(factsOf(group), null, 2)}`
```

- [ ] **Step 5: Write the matcher**

Create `apps/raven/server/src/metadata/aiMatcher.ts`:

```ts
import { relative } from 'node:path'
import type { Anthropic } from '@anthropic-ai/sdk'
import { Inject, Injectable } from '@nestjs/common'
import { type MatchItemType, parseMovieName } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import type { LibraryRecord } from '@/libraries/librariesRepository'
import { AiClient } from '@/metadata/aiClient'
import type { AiOutcome, AiPick } from '@/metadata/aiDecisions'
import {
  AI_SEARCH_RESULTS,
  AI_SYSTEM_PROMPT,
  AI_TOOL_NAMES,
  AI_TOOLS,
  type AiGroup,
  askFor,
  describeCandidate,
  isChooseInput,
  isEpisodesInput,
  isSearchInput,
} from '@/metadata/aiTools'
import type { MatchFile } from '@/metadata/matchFiles'
import { movieSearchTitles, readShowFile, showSearchTitles } from '@/metadata/matchers'
import { notFound } from '@/metadata/matchPass'
import { filePlace } from '@/metadata/places'
import { type SearchResult, TmdbClient } from '@/metadata/tmdbClient'

/** How many file names a lookup is sent, spread over the group. */
export const AI_FILE_SAMPLE = 12

/** How many groups are asked about at once. */
export const AI_CONCURRENCY = 2

/** Replies Claude gets to choose in; past the last, the lookup has no decision. */
export const AI_MAX_TURNS = 6

/** Room for one reply's thinking and its tool calls. */
const MAX_TOKENS = 4000

/** The longest reason kept, in characters. */
const REASON_LENGTH = 500

/** `count` of `items`, evenly spaced from the first, so a long show is sampled over every season. */
const spread = <T>({ items, count }: { items: readonly T[]; count: number }): T[] =>
  items.length <= count
    ? [...items]
    : Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)])

/** A file's path inside its group's place; a loose file is its own place, so its name. */
const inPlace = ({ place, file }: { place: string; file: MatchFile }): string =>
  relative(place, filePlace(file)) || file.fileName

/** Searches as Claude is told of them: the title and year, without the country a search narrows by. */
const plainTitles = (
  titles: ReadonlyArray<{ title: string; year: number | null }>,
): AiGroup['tried'] => titles.map(({ title, year }) => ({ title, year }))

/** What matching read from a group's first file, and the searches it ran with it. */
const readingOf = ({
  type,
  first,
}: {
  type: MatchItemType
  first: MatchFile
}): Pick<AiGroup, 'parsed' | 'tried'> => {
  if (type === 'show') {
    const parsed = readShowFile(first)
    return {
      parsed: { title: parsed.show, year: parsed.year },
      tried: plainTitles(showSearchTitles(parsed)),
    }
  }
  return {
    parsed: { title: first.title, year: first.year },
    tried: plainTitles(movieSearchTitles({ file: first, parsed: parseMovieName(first) })),
  }
}

/**
 * A group left unmatched, as one lookup describes it: the library's type,
 * how its path was read, the group's place, some of its files as paths
 * inside the place, and what matching read and searched. Nothing in it is a
 * path outside the library.
 */
export const aiGroupOf = ({
  library,
  type,
  place,
  files,
}: {
  library: LibraryRecord
  type: MatchItemType
  place: string
  files: readonly MatchFile[]
}): AiGroup => {
  const ordered = files.toSorted((a, b) => filePlace(a).localeCompare(filePlace(b)))
  const [first] = ordered
  if (first == null) throw new Error(`No files to look up for "${place}"`)
  return {
    kind: library.settings.kind,
    type,
    layout: library.layouts.find((entry) => first.path.startsWith(`${entry.path}/`))?.layout ?? null,
    place,
    fileCount: ordered.length,
    fileNames: spread({ items: ordered, count: AI_FILE_SAMPLE }).map((file) =>
      inPlace({ place, file }),
    ),
    ...readingOf({ type, first }),
  }
}

/** One lookup's own state: what `search_tmdb` offered, by type and id. */
type Lookup = { group: AiGroup; offered: Map<string, AiPick> }

/** TMDB's movie and show ids overlap, so an offer is known by both. */
const offeredKey = ({ type, tmdbId }: { type: MatchItemType; tmdbId: string }): string =>
  `${type}:${tmdbId}`

const undecided = (reason: string): AiOutcome => ({ kind: 'undecided', reason })

const answer = ({
  use,
  content,
  isError = false,
}: {
  use: Anthropic.ToolUseBlock
  content: string
  isError?: boolean
}): Anthropic.ToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: use.id,
  content,
  ...(isError ? { is_error: true } : {}),
})

const pickOf = (result: SearchResult): AiPick => ({
  tmdbId: result.tmdbId,
  title: result.title,
  year: result.year,
  poster: result.poster,
})

/**
 * The AI lookup for one group: Claude searches TMDB and lists seasons with
 * the tools until it calls `choose_match`, in at most six replies. Each
 * reply goes back into the conversation whole and unchanged, thinking
 * blocks included, and the conversation only ever grows.
 */
@Injectable()
export class AiMatcher {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
  ) {}

  /** The model lookups ask, kept beside each decision. */
  get model(): string {
    return this.config.aiMatchModel
  }

  /**
   * Which TMDB movie or show `group` is, as Claude decides it. Anthropic
   * failing throws an `AiError`, and TMDB failing a `TmdbError`; either
   * leaves the group to be asked again.
   */
  decide(group: AiGroup): Promise<AiOutcome> {
    return this.turn({
      lookup: { group, offered: new Map() },
      messages: [{ role: 'user', content: askFor(group) }],
      turn: 1,
    })
  }

  private request(
    messages: readonly Anthropic.MessageParam[],
  ): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: this.config.aiMatchModel,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.config.aiMatchEffort },
      // The prompt and the tools never change, so this one breakpoint caches
      // them for every lookup; the top-level one follows the conversation.
      system: [{ type: 'text', text: AI_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: AI_TOOLS,
      tool_choice: { type: 'auto' },
      cache_control: { type: 'ephemeral' },
      messages: [...messages],
    }
  }

  private async turn({
    lookup,
    messages,
    turn,
  }: {
    lookup: Lookup
    messages: readonly Anthropic.MessageParam[]
    turn: number
  }): Promise<AiOutcome> {
    const response = await this.ai.send(this.request(messages))
    // Haiku 5.5 has no server-side fallback for a refusal, so it is no decision.
    if (response.stop_reason === 'refusal') return undecided('Claude declined to look this up.')
    if (response.stop_reason !== 'tool_use') return undecided('The lookup ended without a choice.')
    const uses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    const choice = uses.find((use) => use.name === AI_TOOL_NAMES.choose)
    if (choice != null) return this.choose({ lookup, input: choice.input })
    if (turn >= AI_MAX_TURNS) return undecided(`No choice in ${AI_MAX_TURNS} turns.`)
    const results = await Promise.all(uses.map((use) => this.run({ lookup, use })))
    return this.turn({
      lookup,
      messages: [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: results },
      ],
      turn: turn + 1,
    })
  }

  /** Runs one tool call; one raven cannot run is answered as an error, for Claude to recover from. */
  private run({
    lookup,
    use,
  }: {
    lookup: Lookup
    use: Anthropic.ToolUseBlock
  }): Promise<Anthropic.ToolResultBlockParam> {
    if (use.name === AI_TOOL_NAMES.search) return this.search({ lookup, use })
    if (use.name === AI_TOOL_NAMES.episodes) return this.episodes({ lookup, use })
    return Promise.resolve(
      answer({ use, content: `There is no tool called ${use.name}.`, isError: true }),
    )
  }

  private async search({
    lookup,
    use,
  }: {
    lookup: Lookup
    use: Anthropic.ToolUseBlock
  }): Promise<Anthropic.ToolResultBlockParam> {
    const { input } = use
    if (!isSearchInput(input)) {
      return answer({
        use,
        content: 'search_tmdb takes a type, a title to search for, and a year or null.',
        isError: true,
      })
    }
    const asked = { query: input.query, year: input.year }
    const found = (
      input.type === 'movie'
        ? await this.tmdb.searchMovies(asked)
        : await this.tmdb.searchShows(asked)
    ).slice(0, AI_SEARCH_RESULTS)
    found.forEach((result) =>
      lookup.offered.set(offeredKey({ type: input.type, tmdbId: result.tmdbId }), pickOf(result)),
    )
    return answer({ use, content: JSON.stringify(found.map(describeCandidate)) })
  }

  private async episodes({
    lookup,
    use,
  }: {
    lookup: Lookup
    use: Anthropic.ToolUseBlock
  }): Promise<Anthropic.ToolResultBlockParam> {
    const { input } = use
    if (!isEpisodesInput(input)) {
      return answer({
        use,
        content: 'list_episodes takes a show id and a season number.',
        isError: true,
      })
    }
    if (!lookup.offered.has(offeredKey({ type: 'show', tmdbId: input.tmdbId }))) {
      return answer({
        use,
        content: `Show ${input.tmdbId} came from no search in this lookup; search for it first.`,
        isError: true,
      })
    }
    const season = await this.tmdb
      .season({ showTmdbId: input.tmdbId, number: input.season })
      .catch((error: unknown) => {
        if (notFound(error)) return null
        throw error
      })
    if (season == null) {
      return answer({ use, content: `TMDB lists no season ${input.season} of show ${input.tmdbId}.` })
    }
    return answer({
      use,
      content: JSON.stringify({
        season: input.season,
        episodes: season.episodes.map((episode) => ({
          number: episode.number,
          title: episode.title,
        })),
      }),
    })
  }

  private choose({ lookup, input }: { lookup: Lookup; input: unknown }): AiOutcome {
    if (!isChooseInput(input)) return undecided('Its answer did not fit choose_match.')
    const reason = input.reason.trim().slice(0, REASON_LENGTH)
    if (input.tmdbId == null) return { kind: 'none', confidence: input.confidence, reason }
    const pick = lookup.offered.get(offeredKey({ type: lookup.group.type, tmdbId: input.tmdbId }))
    // An id no search offered in this lookup is never trusted, however sure Claude is.
    if (pick == null) {
      return undecided(`It chose ${input.tmdbId}, which no search in the lookup returned.`)
    }
    return { kind: 'chosen', pick, confidence: input.confidence, reason }
  }
}
```

Add `AiMatcher` to the providers in `appModule.ts`, after `AiClient,`, with `import { AiMatcher } from '@/metadata/aiMatcher'`.

- [ ] **Step 6: Run them to verify they pass**

Run: `bunx nx run @raven/server:test -- src/metadata/aiMatcher.test.ts` then `bunx nx run @raven/server:typecheck` and `bunx nx run @raven/server:lint:ts`
Expected: PASS. If the typecheck rejects `{ role: 'assistant', content: response.content }`, the SDK's `ContentBlock` and `ContentBlockParam` have drifted apart: map each block with a type guard per kind, never a cast, and keep the blocks byte for byte.

- [ ] **Step 7: Commit**

```bash
git add apps/raven/server/src/metadata/aiTools.ts apps/raven/server/src/metadata/aiMatcher.ts apps/raven/server/src/metadata/aiMatcher.test.ts apps/raven/server/src/metadata/matchers.ts apps/raven/server/src/appModule.ts
git commit -m "$(cat <<'EOF'
MAE: raven's AI lookup searches TMDB, checks episodes and chooses

- Three strict tools, `search_tmdb`, `list_episodes` and `choose_match`, their inputs checked with guards
- A stable, cached prompt; at most six replies; the history only grows
- An id no search returned, a refusal or no choice is no decision
- Matching's search titles are exported for the lookup to describe
EOF
)"
```

---

### Task 4: Lookups after a pass, and a sure pick applied

**Files:**
- Modify: `apps/raven/server/src/metadata/places.ts`, `places.test.ts`
- Modify: `apps/raven/server/src/metadata/matchFiles.ts`, `matchFiles.test.ts`
- Modify: `apps/raven/server/src/metadata/matchPass.ts`, `matchPass.test.ts`
- Modify: `apps/raven/server/src/metadata/matchers.ts`, `matchers.test.ts`
- Modify: `apps/raven/server/src/metadata/metadataService.ts`
- Create: `apps/raven/server/src/metadata/aiLookup.test.ts`

**Interfaces:**
- Consumes: `AiClient.take`, `enabled`, `AiError` (Task 1); `AiDecisions` (Task 2); `AiMatcher.decide`, `model`, `aiGroupOf`, `AI_CONCURRENCY` (Task 3); step 3's `MetadataService.newPass(kind)`, `matchPending` (answers whether TMDB stopped the pass), `matchGroups`, `changePreference` and `repick`, as committed at `14b24e8` plus Task 0 (`pass` still clears up a library removed during a stopped pass; `changeKind` and `changePreference` queue with `again`).
- Produces:
  - `groupPlaceOf({ type, file, folderFiles }: { type: MatchItemType; file: { folder: string; fileName: string }; folderFiles: () => ReadonlyArray<{ fileName: string; folder: string }> }): string`
  - `MatchFiles.unmatched(libraryId: number): MatchFile[]`
  - `MatchPass.resolve({ ..., decided?: string | null })`
  - `MatcherDeps.decisions: AiDecisions`
  - `MetadataService`: private `matchPending({ libraryId, type, pass })`, `lookUpUnmatched({ library, type, pass })`, `lookUp(...)`; `retryUnmatched` clears undecided rows; `changeKind` and `relayoutNow` forget a library's decisions
  - `aiLookup.test.ts` with a `startServer({ prefix, files, aiDailyLimit })` helper returning `{ tmdb, claude, state, app, settle, get, start, stop, matchAgain, askedSince }`, the constants `SHOWS`, `LOOKUPS`, `WILD_REASON`, `ARCHIE_REASON`, and two describes that Task 5 adds to

- [ ] **Step 1: Write the failing place test**

Add `groupPlaceOf` to the `@/metadata/places` import in `places.test.ts`, and append inside its `describe`:

```ts
  it("keeps a group's decision where its Fix match is kept", () => {
    const none = () => []
    const episode = file('/tv/Severance/Season 01/Severance - S01E01.mkv')
    expect(groupPlaceOf({ type: 'show', file: episode, folderFiles: none })).toBe('Severance')
    const loose = file('/tv/Severance - S01E01.mkv')
    expect(groupPlaceOf({ type: 'show', file: loose, folderFiles: none })).toBe(
      'Severance - S01E01.mkv',
    )
    const heat = file('/films/Heat (1995)/Heat (1995) 1080p.mkv', '/films')
    const heatUhd = file('/films/Heat (1995)/Heat (1995) 2160p.mkv', '/films')
    expect(groupPlaceOf({ type: 'movie', file: heat, folderFiles: () => [heat, heatUhd] })).toBe(
      'Heat (1995)',
    )
    const shared = file('/films/Michael Mann/Heat (1995).mkv', '/films')
    const thief = file('/films/Michael Mann/Thief (1981).mkv', '/films')
    expect(groupPlaceOf({ type: 'movie', file: shared, folderFiles: () => [shared, thief] })).toBe(
      'Michael Mann/Heat (1995).mkv',
    )
    const atRoot = file('/films/Heat (1995).mkv', '/films')
    expect(groupPlaceOf({ type: 'movie', file: atRoot, folderFiles: none })).toBe('Heat (1995).mkv')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx nx run @raven/server:test -- src/metadata/places.test.ts`
Expected: FAIL, `groupPlaceOf` is not exported.

- [ ] **Step 3: Write `groupPlaceOf`**

In `apps/raven/server/src/metadata/places.ts`, change the core import to `import { foldTitle, isExtra, type MatchItemType, parseMovieName, showFolderOf } from '@raven/core'` and append:

```ts
/**
 * The place a group keeps its Fix match and AI decision under, as
 * `fixGroup` reads it: a show's folder (or the file, at a root), a movie's
 * folder when it holds that one movie, else the movie file's own place.
 */
export const groupPlaceOf = ({
  type,
  file,
  folderFiles,
}: {
  type: MatchItemType
  file: { folder: string; fileName: string }
  /** The files in the movie's folder, read only for a movie in a folder. */
  folderFiles: () => ReadonlyArray<{ fileName: string; folder: string }>
}): string => {
  if (type === 'show') return showPlace(file)
  return holdsOneMovie({ folder: file.folder, files: file.folder === '' ? [] : folderFiles() })
    ? file.folder
    : filePlace(file)
}
```

- [ ] **Step 4: Write the failing queue and pass tests**

In `matchFiles.test.ts`, append inside `describe('the match queue', ...)`:

```ts
  it("lists a library's files no movie or show was found for", () => {
    const id = (path: string) => state.ids.get(path) ?? -1
    files().setMatch({ ids: [id('Elsewhere/Elsewhere - S01E01.mkv')], match: 'unmatched' })
    expect(names(files().unmatched(state.libraryId))).toEqual(['Elsewhere - S01E01.mkv'])
    files().setMatch({ ids: [id('Elsewhere/Elsewhere - S01E01.mkv')], match: 'pending' })
    expect(files().unmatched(state.libraryId)).toEqual([])
  })
```

In `matchPass.test.ts`, append inside the first `describe`:

```ts
  it('takes a sure AI pick only when a search finds nothing, and never over a Fix match', async () => {
    const ask = (overrides: Partial<Parameters<MatchPass['resolve']>[0]>) =>
      pass().resolve({
        type: 'show',
        fix: { kind: 'none' },
        ids: NO_IDS,
        nfoPath: null,
        titles: [{ title: 'Severance', year: null }],
        decided: '30991',
        ...overrides,
      })
    await expect(ask({})).resolves.toMatchObject({ kind: 'matched', tmdbId: '95396' })
    await expect(ask({ titles: [{ title: 'Nothing Like It', year: null }] })).resolves.toMatchObject({
      kind: 'matched',
      tmdbId: '30991',
      match: 'matched',
    })
    await expect(ask({ fix: { kind: 'not-a-match' } })).resolves.toEqual({ kind: 'unmatched' })
    await expect(ask({ fix: { kind: 'tmdb', tmdbId: '90660' } })).resolves.toMatchObject({
      tmdbId: '90660',
      match: 'manual',
    })
  })
```

- [ ] **Step 5: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/metadata/matchFiles.test.ts src/metadata/matchPass.test.ts`
Expected: FAIL: `unmatched` is not a function, and the pass resolves `Nothing Like It` to unmatched.

- [ ] **Step 6: The queue lists unmatched files, and a pass takes the pick**

In `matchFiles.ts`, after `pending`:

```ts
  /** A library's files no movie or show was found for, by place so a folder's files come together. */
  unmatched(libraryId: number): MatchFile[] {
    return this.files({ where: `m.library_id = ? AND m.match = 'unmatched'`, params: [libraryId] })
  }
```

In `matchPass.ts`, replace `resolve`'s comment, signature and the `tmdbId` expression:

```ts
  /**
   * The movie or show a set of files is: a Fix match wins, then an id in a
   * name or NFO, then a search for each of `titles` in turn that only takes a
   * sure answer, then the AI lookup's sure pick. Unmatched when the Fix match
   * says it is none, nothing is found, or TMDB has no such item.
   */
  async resolve({
    type,
    fix,
    ids,
    nfoPath,
    titles,
    decided = null,
  }: {
    type: MatchItemType
    fix: FixMatch
    ids: NameIds
    nfoPath: string | null
    titles: readonly SearchTitle[]
    /** The TMDB id the AI lookup chose for the group, being sure; null when it was not asked, unsure, or chose nothing. */
    decided?: string | null
  }): Promise<Resolved> {
    if (fix.kind === 'not-a-match') return { kind: 'unmatched' }
    const tmdbId =
      fix.kind === 'tmdb'
        ? fix.tmdbId
        : ((await this.fromIds({ type, ids, nfoPath })) ??
          (await this.searchEach({ type, titles })) ??
          decided)
```

(the rest of `resolve` is unchanged: a decided id is `matched`, never `manual`).

- [ ] **Step 7: Matchers hand the pick over**

In `matchers.ts`:

Add `import type { AiDecisions } from '@/metadata/aiDecisions'`.

Add to `MatcherDeps`:

```ts
  /** The AI lookup's decisions, whose sure pick a group takes when its own search finds nothing. */
  decisions: AiDecisions
```

In `movieMatcher`, after `fixFor`:

```ts
  /** A sure AI pick for a movie file: kept at its own place, or at its folder's when that is one movie. */
  const decidedFor = ({ file, own }: { file: MatchFile; own: boolean }): string | null =>
    deps.decisions.highPickAt({ libraryId: file.libraryId, place: filePlace(file) }) ??
    (own ? deps.decisions.highPickAt({ libraryId: file.libraryId, place: file.folder }) : null)
```

and in `matchMovie`'s `pass.resolve({...})`, after `titles`:

```ts
      decided: decidedFor({ file, own }),
```

In `matchShowGroup`, add `const place = showPlace(first)` after `const parsed = readShowFile(first)`, change `fix:` to `deps.files.fixMatchAt({ libraryId: first.libraryId, place })`, and add after `titles`:

```ts
      decided: deps.decisions.highPickAt({ libraryId: first.libraryId, place }),
```

In `matchers.test.ts`, add `import { AiDecisions } from '@/metadata/aiDecisions'` and change the matchers line to:

```ts
      matchers: createMatchers({
        files,
        metadata,
        pictures,
        decisions: new AiDecisions(database.get()),
      }),
```

Run: `bunx nx run @raven/server:test -- src/metadata/places.test.ts src/metadata/matchFiles.test.ts src/metadata/matchPass.test.ts src/metadata/matchers.test.ts`
Expected: PASS.

- [ ] **Step 8: Write the failing end to end tests**

Create `apps/raven/server/src/metadata/aiLookup.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isLibrary, isShowListing, type LibraryKind } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { encodeClip } from '@/test/clips'
import { type FakeReply, fakeClaude } from '@/test/fakeClaude'
import { type FakeShow, fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = { statusCode: number; rawPayload: Buffer; json: () => unknown }

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

/** TMDB knows the show the misnamed folder is, and two shows called Archie something. */
const SHOWS: FakeShow[] = [
  {
    id: 80001,
    title: 'Wild Arctic',
    first: '2018-01-07',
    seasons: {
      1: [
        { number: 1, title: 'Polar Night', aired: '2018-01-07' },
        { number: 2, title: 'The Thaw', aired: '2018-01-14' },
      ],
    },
  },
  {
    id: 201000,
    title: 'Archie: The Man Who Became Cary Grant',
    first: '2023-12-07',
    seasons: { 1: [{ number: 1, title: 'Episode 1', aired: '2023-12-07' }] },
  },
  { id: 4321, title: 'The Archie Show', first: '1968-09-14', seasons: {} },
]

const WILD_REASON = "Season 1's episode titles match TMDB's (Polar Night, The Thaw)."
const ARCHIE_REASON = 'The only Archie series from 2023; its episode titles are generic.'

/** What Claude does for each group, as the spike saw it: sure, unsure, and nothing. */
const LOOKUPS: Record<string, readonly FakeReply[]> = {
  'Destination Wild Arctic': [
    { kind: 'search', type: 'show', query: 'Wild Arctic', year: null },
    { kind: 'episodes', tmdbId: '80001', season: 1 },
    { kind: 'choose', tmdbId: '80001', confidence: 'high', reason: WILD_REASON },
  ],
  Archie: [
    { kind: 'search', type: 'show', query: 'Archie', year: null },
    { kind: 'choose', tmdbId: '201000', confidence: 'low', reason: ARCHIE_REASON },
  ],
  'Cesar 911': [
    { kind: 'search', type: 'show', query: 'Cesar 911', year: null },
    {
      kind: 'choose',
      tmdbId: null,
      confidence: 'high',
      reason: 'The files are episodes of another show.',
    },
  ],
}

const WILD = [
  'Destination Wild Arctic/Season 1/Destination Wild Arctic - S01E01 - Polar Night.mp4',
  'Destination Wild Arctic/Season 1/Destination Wild Arctic - S01E02 - The Thaw.mp4',
]
const ARCHIE = 'Archie/Season 1/Archie - S01E01 - Episode 1.mp4'
const CESAR = 'Cesar 911/Season 1/Cesar 911 - S01E01 - Lilly.mp4'

/**
 * A server over a temp tree, answering for TMDB and Claude: `files` in a TV
 * shows library, and one video in an Other library beside it.
 */
const startServer = ({
  prefix,
  files,
  aiDailyLimit,
}: {
  prefix: string
  files: readonly string[]
  aiDailyLimit: number
}) => {
  const tmdb = fakeTmdb({ movies: [], shows: SHOWS })
  const claude = fakeClaude({ lookups: LOOKUPS })
  const state: {
    root: string
    app: NestFastifyApplication | null
    library: number
    clips: number
  } = { root: '', app: null, library: 0, clips: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const settle = async () => {
    await app().get(ScannerService).whenIdle(state.library)
    await app().get(ScannerService).whenIdle(state.clips)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const get = async <T>({
    url,
    guard,
  }: {
    url: string
    guard: (value: unknown) => value is T
  }): Promise<T> => shape({ response: await app().inject({ method: 'GET', url }), guard })
  const create = async ({ name, path, kind }: { name: string; path: string; kind: LibraryKind }) =>
    shape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name, paths: [path], settings: { kind } },
      }),
      guard: isLibrary,
    }).id
  const start = async () => {
    state.root = await mkdtemp(join(tmpdir(), prefix))
    await Promise.all(
      files.map((path) => encodeClip({ path: join(state.root, 'TV', path), seconds: 1 })),
    )
    await encodeClip({ path: join(state.root, 'Clips', 'Birthday Party.mp4'), seconds: 1 })
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
        anthropicApiKey: 'test-key',
        aiDailyLimit,
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
      aiFetch: claude.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.clips = await create({ name: 'Clips', path: join(state.root, 'Clips'), kind: 'other' })
    state.library = await create({ name: 'TV', path: join(state.root, 'TV'), kind: 'shows' })
    await settle()
  }
  const stop = async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  }
  const matchAgain = async () => {
    await app().inject({ method: 'POST', url: `/api/libraries/${state.library}/match` })
    await settle()
  }
  /** The places Claude was asked about from request `from` on, each once, in order. */
  const askedSince = (from: number): string[] => [
    ...new Set(claude.state.requests.slice(from).flatMap((request) => request.place ?? [])),
  ]
  return { tmdb, claude, state, app, settle, get, start, stop, matchAgain, askedSince }
}

describe('the AI lookup', () => {
  const server = startServer({
    prefix: 'raven-ai-',
    files: [...WILD, ARCHIE, CESAR],
    aiDailyLimit: 200,
  })
  const shows = () =>
    server.get({ url: `/api/libraries/${server.state.library}/shows`, guard: isShowListing })

  beforeAll(server.start)
  afterAll(server.stop)

  it('asks once about each group the matcher left, sending nothing outside the library', () => {
    const { requests } = server.claude.state
    expect(server.askedSince(0).toSorted()).toEqual(['Archie', 'Cesar 911', 'Destination Wild Arctic'])
    expect(requests).toHaveLength(7)
    expect(requests.every((request) => request.apiKey === 'test-key')).toBe(true)
    expect(requests.filter((request) => request.raw.includes(server.state.root))).toEqual([])
    expect(requests.filter((request) => request.raw.includes('Birthday'))).toEqual([])
  })

  it('matches the group it was sure of, episodes and all, and leaves the rest not matched', async () => {
    const listing = await shows()
    expect(listing.shows.map((entry) => [entry.show.title, entry.episodes])).toEqual([
      ['Wild Arctic', 2],
    ])
    expect(listing.shows[0]?.next?.match).toBe('matched')
    expect(listing.unmatched.map((file) => file.fileName).toSorted()).toEqual([
      'Archie - S01E01 - Episode 1.mp4',
      'Cesar 911 - S01E01 - Lilly.mp4',
    ])
  })

  it('asks again after Match again only where it chose no id, and never where Fix match says none', async () => {
    const asked = server.claude.state.requests.length
    await server.matchAgain()
    expect(server.askedSince(asked)).toEqual(['Cesar 911'])

    const cesar = (await shows()).unmatched.find((file) => file.fileName.startsWith('Cesar'))
    await server.app().inject({
      method: 'PUT',
      url: `/api/media/${cesar?.id ?? -1}/match`,
      payload: { tmdbId: null },
    })
    await server.settle()
    const before = server.claude.state.requests.length
    await server.matchAgain()
    expect(server.claude.state.requests).toHaveLength(before)
  })
})

describe("the AI lookup's daily limit, and Anthropic away", () => {
  const server = startServer({ prefix: 'raven-ai-limit-', files: [ARCHIE, CESAR], aiDailyLimit: 3 })

  beforeAll(async () => {
    server.claude.state.status = 529
    await server.start()
  })
  afterAll(server.stop)

  it('keeps nothing while Anthropic is away, and leaves the files not matched', async () => {
    // A full scan queues one pass, which asked about both groups before either failed.
    expect(server.askedSince(0).toSorted()).toEqual(['Archie', 'Cesar 911'])
    expect(server.claude.state.requests).toHaveLength(2)
    const listing = await server.get({
      url: `/api/libraries/${server.state.library}/shows`,
      guard: isShowListing,
    })
    expect(listing.unmatched).toHaveLength(2)
  })

  it('asks again on the next pass, as far as the day allows', async () => {
    server.claude.state.status = 200
    const asked = server.claude.state.requests.length
    await server.matchAgain()
    expect(server.askedSince(asked)).toEqual(['Archie'])
  })
})
```

- [ ] **Step 9: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/metadata/aiLookup.test.ts`
Expected: FAIL: no request reaches the fake Claude, as nothing asks yet.

- [ ] **Step 10: Ask after a pass**

In `apps/raven/server/src/metadata/metadataService.ts`:

Add the imports:

```ts
import { AiClient, AiError } from '@/metadata/aiClient'
import { AiDecisions } from '@/metadata/aiDecisions'
import { AI_CONCURRENCY, aiGroupOf, AiMatcher } from '@/metadata/aiMatcher'
```

and change `import { showPlace } from '@/metadata/places'` to `import { groupPlaceOf, showPlace } from '@/metadata/places'`.

Add one sentence to the class comment, after `Every pass ends by removing items, people and pictures nothing uses any more.`: `Before that, with an AI key, each group a pass left unmatched and never asked about goes to the AI lookup.`

Add to the constructor, after `pictures`:

```ts
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(AiMatcher) private readonly aiMatcher: AiMatcher,
    @Inject(AiDecisions) private readonly decisions: AiDecisions,
  ) {
    this.matchers = createMatchers({ files, metadata, pictures, decisions })
  }
```

In `retryUnmatched`, as its first line:

```ts
    // The lookups that chose no id are asked again with the files.
    this.decisions.clearUndecided(libraryId)
```

and add to its comment: `The AI lookup asks again about the groups it chose no id for.`

In `changeKind`'s task and in `changePreference`'s task (step 3 added it), before their `this.relayoutNow(libraryId)`:

```ts
        // Claude was told the old type, and the places may mean other groups now.
        this.decisions.forget(libraryId)
```

(In `changePreference` this means a group an AI pick matched loses it in `repick`, searches again with the new type's tiers, and is asked again in the pass that follows.)

In `relayoutNow`, after `this.files.applyRelayout({ ... })`:

```ts
    // The decisions were kept by the old places.
    this.decisions.forget(libraryId)
```

The next edits are written against step 3 as committed on `raven-smart-scan-types` at `14b24e8` and Task 0's changes, where `matchPending({ libraryId, kind, type })` makes its own pass and answers whether TMDB stopped it, and `pass` returns early, skipping the clear-up, when it did. Keep that behaviour; if step 3 changed these two methods again before this step starts, make the same two changes to whatever is there: hand the pass in, and ask the AI lookup after a pass TMDB did not stop.

Replace `pass` with:

```ts
  private async pass(libraryId: number): Promise<void> {
    const library = this.libraries.get(libraryId)
    const kind = library?.settings.kind
    const type = kind == null ? null : matchTypeFor(kind)
    if (library != null && kind != null && type != null && this.tmdb.enabled) {
      this.tmdb.newPass()
      const pass = this.newPass(kind)
      const isStopped = await this.matchPending({ libraryId, type, pass })
      // The items of files still waiting for TMDB stay, with their edits and
      // pictures, until a pass that gets through matches the files to them
      // again. A library removed meanwhile is cleared up all the same.
      if (isStopped && this.libraries.get(libraryId) != null) return
      await this.lookUpUnmatched({ library, type, pass })
      // A lookup that found TMDB away stops the pass the same way.
      if (pass.guard.isStopped && this.libraries.get(libraryId) != null) return
    }
    await this.pictures.clearUp()
  }
```

In `matchPending`, take the pass instead of the kind: change its parameters to

```ts
  private async matchPending({
    libraryId,
    type,
    pass,
  }: {
    libraryId: number
    type: MatchItemType
    pass: MatchPass
  }): Promise<boolean> {
```

delete its first line, `const pass = this.newPass(kind)`, and change its comment's first sentence to `Matches the library's pending files with \`pass\`, and any that turn up while it runs.` The rest of it (the rounds through `matchGroups`, `reportStop`, the answer) stays as step 3 wrote it.

After `matchPending`, add:

```ts
  /**
   * Asks the AI lookup about every group the pass left unmatched that has
   * no Fix match and was never asked, two at a time, while today's lookups
   * last. Libraries that are never matched never get here.
   */
  private async lookUpUnmatched({
    library,
    type,
    pass,
  }: {
    library: LibraryRecord
    type: MatchItemType
    pass: MatchPass
  }): Promise<void> {
    if (!this.ai.enabled || pass.guard.isStopped) return
    const libraryId = library.id
    const groups = [
      ...groupBy({
        items: this.files.unmatched(libraryId),
        key: (file) =>
          groupPlaceOf({
            type,
            file,
            folderFiles: () => this.files.inFolder({ libraryId, folder: file.folder }),
          }),
      }),
    ].flatMap(([place, files]) =>
      this.files.fixMatchAt({ libraryId, place }).kind === 'none' &&
      !this.decisions.isAsked({ libraryId, place })
        ? [{ place, files }]
        : [],
    )
    const halted = { now: false }
    await mapWithConcurrency({
      items: groups,
      limit: AI_CONCURRENCY,
      fn: ({ place, files }) =>
        pass.guard.run(() => this.lookUp({ library, type, place, files, pass, halted })),
    })
    pass.guard.reportStop()
  }

  /**
   * One lookup: books one of today's, keeps the answer, and matches the
   * group again at once, with the pass's searches, when the pick is sure.
   * Anthropic failing halts the pass's other lookups and keeps nothing, so
   * the group is asked on the next pass; TMDB failing stops the pass.
   */
  private async lookUp({
    library,
    type,
    place,
    files,
    pass,
    halted,
  }: {
    library: LibraryRecord
    type: MatchItemType
    place: string
    files: readonly MatchFile[]
    pass: MatchPass
    halted: { now: boolean }
  }): Promise<void> {
    if (halted.now || !this.ai.take()) return
    const outcome = await this.aiMatcher
      .decide(aiGroupOf({ library, type, place, files }))
      .catch((error: unknown) => {
        if (!(error instanceof AiError)) throw error
        halted.now = true
        this.logger.warn(`AI lookups stopped for now: ${error.message}`)
        return null
      })
    // A library removed during the lookup keeps no decision.
    if (outcome == null || this.libraries.get(library.id) == null) return
    this.decisions.record({ libraryId: library.id, place, outcome, model: this.aiMatcher.model })
    if (outcome.kind !== 'chosen' || outcome.confidence !== 'high') return
    this.files.reset(files.map((file) => file.id))
    await this.matchers[type].match({ files, pass })
  }
```

- [ ] **Step 11: Run them to verify they pass**

Run: `bunx nx run @raven/server:test -- src/metadata/aiLookup.test.ts`
Expected: PASS.

- [ ] **Step 12: Run every server test and the checks**

Run: `bunx nx run @raven/server:test` then `bunx nx run @raven/server:typecheck` and `bunx nx run @raven/server:lint:ts`
Expected: PASS. Every other suite runs without a key, so the lookup is off there and nothing changes.

- [ ] **Step 13: Commit**

```bash
git add apps/raven/server/src/metadata/places.ts apps/raven/server/src/metadata/places.test.ts apps/raven/server/src/metadata/matchFiles.ts apps/raven/server/src/metadata/matchFiles.test.ts apps/raven/server/src/metadata/matchPass.ts apps/raven/server/src/metadata/matchPass.test.ts apps/raven/server/src/metadata/matchers.ts apps/raven/server/src/metadata/matchers.test.ts apps/raven/server/src/metadata/metadataService.ts apps/raven/server/src/metadata/aiLookup.test.ts
git commit -m "$(cat <<'EOF'
MAE: raven asks the AI lookup about what a pass leaves unmatched

- After a pass, each group with no Fix match and no decision is asked once, two at a time, within the day's limit
- A sure pick matches the group at once, after search in `MatchPass.resolve`; an unsure one waits as a suggestion
- Match again asks again where no id was chosen; a type change or relayout forgets a library's decisions
- An outage keeps nothing, so the next pass asks again
EOF
)"
```

---

### Task 5: The API: suggestions, the "Matched by AI" reason and health

**Files:**
- Modify: `libs/raven/core/src/contract.ts`, `contract.test.ts`
- Modify: `libs/raven/core/src/apiClient.ts`, `apiClient.test.ts`
- Modify: `libs/raven/core/src/test/fixtures.ts`
- Modify: `apps/raven/server/src/metadata/aiDecisions.ts` (use core's `AiSuggestion`)
- Modify: `apps/raven/server/src/metadata/metadataService.ts`
- Modify: `apps/raven/server/src/metadata/metadataRepository.ts`
- Modify: `apps/raven/server/src/libraries/librariesController.ts`
- Modify: `apps/raven/server/src/items/itemsController.ts`
- Modify: `apps/raven/server/src/metadata/aiLookup.test.ts`, `movies.test.ts`
- Modify: `apps/raven/web/src/test/fixtures.ts`, `apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx`, `LibraryPage.test.tsx`

**Interfaces:**
- Consumes: `AiDecisions.suggestionsAt`, `highReason`, `DecisionPlace` (Task 2); `groupPlaceOf` (Task 4); `AiClient.state`, `remaining` (Task 1).
- Produces:
  - core: `isAiMatch`, `type AiMatch = { reason: string }`; `ItemDetails.aiMatch: AiMatch | null`; `isAiSuggestion`, `type AiSuggestion = { tmdbId; title; year; poster; reason }`; `isUnmatchedFile`, `type UnmatchedFile = MediaItem & { aiSuggestion: AiSuggestion | null }`; `isUnmatchedList`; `MetadataHealth.ai: 'off' | 'ok' | 'failing'`, `MetadataHealth.aiRemaining: number`
  - `api.listUnmatched(libraryId): Promise<UnmatchedFile[]>`
  - server: `MetadataService.withSuggestions({ libraryId, type, files }): UnmatchedFile[]`, `MetadataService.aiMatchFor({ id, type, tmdbId, sees }): AiMatch | null`
  - web fixtures: `unmatchedFile(overrides?: Partial<UnmatchedFile>): UnmatchedFile`

- [ ] **Step 1: Write the failing contract tests**

In `libs/raven/core/src/contract.test.ts`, add `isAiSuggestion`, `isUnmatchedFile` and `isUnmatchedList` to the `@/contract` import.

Change the two `isMetadataHealth` assertions to carry the new fields:

```ts
    expect(
      isMetadataHealth({
        tmdb: 'off',
        omdb: 'off',
        pending: 0,
        error: null,
        lastOk: null,
        ai: 'off',
        aiRemaining: 0,
      }),
    ).toBe(true)
    expect(
      isMetadataHealth({
        tmdb: 'broken',
        omdb: 'off',
        pending: 0,
        error: null,
        lastOk: null,
        ai: 'off',
        aiRemaining: 0,
      }),
    ).toBe(false)
    expect(
      isMetadataHealth({ tmdb: 'ok', omdb: 'off', pending: 0, error: null, lastOk: null }),
    ).toBe(false)
```

In `'takes the whole health check, its metadata included'`, change `metadata` to `{ tmdb: 'off', omdb: 'off', pending: 0, error: null, lastOk: null, ai: 'ok', aiRemaining: 200 }`.

Append a new `describe`:

```ts
describe('the AI lookup', () => {
  const suggestion = {
    tmdbId: '201000',
    title: 'Archie: The Man Who Became Cary Grant',
    year: 2023,
    poster: null,
    reason: 'Generic episode titles.',
  }

  it('takes a suggestion with a TMDB id, and a file Not matched lists with one or none', () => {
    expect(isAiSuggestion(suggestion)).toBe(true)
    expect(isAiSuggestion({ ...suggestion, tmdbId: 'tt123' })).toBe(false)
    expect(isAiSuggestion({ ...suggestion, reason: null })).toBe(false)
    expect(isUnmatchedFile({ ...mediaItem(), aiSuggestion: suggestion })).toBe(true)
    expect(isUnmatchedList([{ ...mediaItem(), aiSuggestion: null }])).toBe(true)
    expect(isUnmatchedFile(mediaItem())).toBe(false)
  })

  it('says why an item was matched by AI, or nothing', () => {
    expect(isItemDetails(itemDetails({ aiMatch: { reason: 'Episode titles match.' } }))).toBe(true)
    expect(isItemDetails(itemDetails({ aiMatch: null }))).toBe(true)
    expect(isItemDetails({ ...itemDetails(), aiMatch: { why: 'x' } })).toBe(false)
    const { aiMatch: _aiMatch, ...without } = itemDetails()
    expect(isItemDetails(without)).toBe(false)
  })
})
```

In `libs/raven/core/src/test/fixtures.ts`, add `aiMatch: null,` to `itemDetails` after `logoVersion: null,`.

In `libs/raven/core/src/apiClient.test.ts`:
- in `'reads the metadata part of the health check'`, add `ai: 'ok',` and `aiRemaining: 200,` to `metadata`;
- in the test that lists a library's tabs, change `await asked({ body: [mediaItem()], call: (client) => client.listUnmatched(3) }),` to `await asked({ body: [{ ...mediaItem(), aiSuggestion: null }], call: (client) => client.listUnmatched(3) }),`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx nx run @raven/core:test -- src/contract.test.ts src/apiClient.test.ts`
Expected: FAIL: the guards are not exported, and the old health shape still passes.

- [ ] **Step 3: Write the guards**

In `libs/raven/core/src/contract.ts`:

Before `/** Everything a movie, show, season or episode page shows. */` (above `isItemDetails`), add:

```ts
/** Why the AI lookup matched a movie or show it was sure of, in Claude's words. */
export const isAiMatch = object({ reason: isString })

export type AiMatch = Infer<typeof isAiMatch>
```

In `isItemDetails`, after `logoVersion`:

```ts
  /**
   * Why the AI lookup matched it, when it did, being sure; null when a
   * search, an id or Fix match did, and for a season or episode.
   */
  aiMatch: nullable(isAiMatch),
```

After `export const isMatchCandidateList = listOf(isMatchCandidate)`, add:

```ts
/**
 * A movie or show the AI lookup offers for files it was not sure of.
 * Accepting it is a Fix match to `tmdbId`.
 */
export const isAiSuggestion = object({
  tmdbId: isTmdbId,
  title: isString,
  year: nullable(isNumber),
  /** TMDB's path for the poster, served through `candidatePosterUrl`. */
  poster: nullable(isString),
  /** Why Claude thinks so, in a sentence or two. */
  reason: isString,
})

export type AiSuggestion = Infer<typeof isAiSuggestion>

/** A file no movie or show was found for, as Not matched lists it. */
export const isUnmatchedFile = object({
  ...isMediaItem.shape,
  /** What the AI lookup suggests for its folder; null when it was not asked, chose nothing, or is sure. */
  aiSuggestion: nullable(isAiSuggestion),
})

export type UnmatchedFile = Infer<typeof isUnmatchedFile>

export const isUnmatchedList = listOf(isUnmatchedFile)
```

In `isMetadataHealth`, after `lastOk`:

```ts
  /** The AI lookup: `off` without ANTHROPIC_API_KEY, `failing` when its last call went wrong. */
  ai: isMetadataServiceState,
  /** AI lookups left today; 0 while it is off. */
  aiRemaining: isNumber,
```

In `libs/raven/core/src/apiClient.ts`, import `isUnmatchedList` and `type UnmatchedFile` from `@/contract`, and change `listUnmatched`:

```ts
    /** A library's files no movie or show was found for, each with the AI lookup's suggestion for its folder. */
    listUnmatched: (libraryId: number): Promise<UnmatchedFile[]> =>
      libraryGet({ libraryId, path: 'unmatched', guard: isUnmatchedList }),
```

Run: `bunx nx run @raven/core:test` then `bunx nx run @raven/core:typecheck`
Expected: PASS.

- [ ] **Step 4: Keep the web's fixtures whole**

In `apps/raven/web/src/test/fixtures.ts`:
- add `aiMatch: null,` to `itemDetails` after `logoVersion: null,`;
- add `UnmatchedFile` to its `import type { ... } from '@raven/core'` list, and after `matchedMovie`:

```ts
/** A file Not matched lists: unmatched, with no AI suggestion unless given one. */
export const unmatchedFile = (overrides: Partial<UnmatchedFile> = {}): UnmatchedFile => ({
  ...mediaItem({ match: 'unmatched' }),
  aiSuggestion: null,
  ...overrides,
})
```

In `apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx`, import `unmatchedFile` from `@/test/fixtures`, and in the three `spies.unmatched` mocks and the `lost` helper, write `unmatchedFile({ ... })` where they write `mediaItem({ ... })`. Add `ai: 'off', aiRemaining: 0,` to its `spies.health` mock. In `apps/raven/web/src/pages/LibraryPage/LibraryPage.test.tsx`, add the same two fields to its `spies.health` mock.

Run: `bunx nx run @raven/web:typecheck` then `bunx nx run @raven/web:test -- src/pages/LibraryPage`
Expected: PASS.

- [ ] **Step 5: Write the failing server tests**

In `apps/raven/server/src/metadata/aiLookup.test.ts`, add `isItemDetails`, `isMetadataHealth`, `isRecord` and `isUnmatchedList` to the `@raven/core` import.

In `startServer`, before the `return`, add:

```ts
  const health = async () => {
    const response = await app().inject({ method: 'GET', url: '/api/health' })
    const body: unknown = response.json()
    const metadata = isRecord(body) ? body.metadata : null
    if (!isMetadataHealth(metadata)) throw new Error(`Unexpected health: ${response.body}`)
    return { metadata, body: response.body }
  }
  const unmatched = () =>
    get({ url: `/api/libraries/${state.library}/unmatched`, guard: isUnmatchedList })
  /** How many lookups were started: a lookup's first request has no reply before it. */
  const lookups = () => claude.state.requests.filter((request) => request.turn === 0).length
```

and add `health, unmatched, lookups` to the returned object.

Append inside `describe('the AI lookup', ...)`:

```ts
  it("lists the unsure pick beside the files it is for, and nothing for the rest", async () => {
    const files = await server.unmatched()
    expect(files.map((file) => [file.fileName, file.aiSuggestion])).toEqual([
      [
        'Archie - S01E01 - Episode 1.mp4',
        {
          tmdbId: '201000',
          title: 'Archie: The Man Who Became Cary Grant',
          year: 2023,
          poster: '/showposter201000.jpg',
          reason: ARCHIE_REASON,
        },
      ],
      ['Cesar 911 - S01E01 - Lilly.mp4', null],
    ])
  })

  it('says a show it was sure of was matched by AI, and why; never its episodes', async () => {
    const listing = await shows()
    const wild = listing.shows[0]
    const details = await server.get({
      url: `/api/items/${wild?.show.id ?? -1}`,
      guard: isItemDetails,
    })
    expect(details.aiMatch).toEqual({ reason: WILD_REASON })
    const episode = await server.get({
      url: `/api/items/${wild?.next?.item?.id ?? -1}`,
      guard: isItemDetails,
    })
    expect(episode.aiMatch).toBeNull()
  })

  it('reports the lookup in the health check, never its key', async () => {
    const { metadata, body } = await server.health()
    expect(metadata).toMatchObject({ ai: 'ok', aiRemaining: 200 - server.lookups() })
    expect(body).not.toContain('test-key')
  })

  it('takes an accepted suggestion as a Fix match, which no AI note claims', async () => {
    const archie = (await server.unmatched()).find((file) => file.aiSuggestion != null)
    await server.app().inject({
      method: 'PUT',
      url: `/api/media/${archie?.id ?? -1}/match`,
      payload: { tmdbId: archie?.aiSuggestion?.tmdbId },
    })
    await server.settle()
    expect((await server.unmatched()).map((file) => file.fileName)).toEqual([
      'Cesar 911 - S01E01 - Lilly.mp4',
    ])
    const listing = await shows()
    const accepted = listing.shows.find((entry) => entry.show.title.startsWith('Archie'))
    expect(accepted?.next?.match).toBe('manual')
    const details = await server.get({
      url: `/api/items/${accepted?.show.id ?? -1}`,
      guard: isItemDetails,
    })
    expect(details.aiMatch).toBeNull()
  })
```

Append inside the daily limit `describe`, as its first test (before the two already there, so it reads the state the outage left):

```ts
  it('is failing in the health check while Anthropic is away', async () => {
    expect((await server.health()).metadata).toMatchObject({ ai: 'failing', aiRemaining: 1 })
    expect((await server.unmatched()).map((file) => file.aiSuggestion)).toEqual([null, null])
  })
```

and at the end of `'asks again on the next pass, as far as the day allows'`:

```ts
    expect((await server.health()).metadata).toMatchObject({ ai: 'ok', aiRemaining: 0 })
```

In `apps/raven/server/src/metadata/movies.test.ts`, in `'reports metadata in the health check'`, add `ai: 'off',` and `aiRemaining: 0,` to the `toMatchObject`.

- [ ] **Step 6: Run them to verify they fail**

Run: `bunx nx run @raven/server:test -- src/metadata/aiLookup.test.ts src/metadata/movies.test.ts`
Expected: FAIL: the server's health has no `ai`, item details no `aiMatch`, and the unmatched listing no `aiSuggestion`, so every guarded response is "Unexpected body".

- [ ] **Step 7: Answer with them**

In `apps/raven/server/src/metadata/aiDecisions.ts`, replace the local `Suggestion` type with core's: import `type AiSuggestion` from `@raven/core`, delete `type Suggestion`, and change `suggestionsAt`'s return type to `Map<string, AiSuggestion>`.

In `apps/raven/server/src/metadata/metadataRepository.ts`, change `details`' return type to `Omit<ItemDetails, 'versions' | 'children' | 'aiMatch'> | null` and its comment to `An item's page, apart from its files, its children and the AI note, which the caller adds.`

In `apps/raven/server/src/metadata/metadataService.ts`:

Extend the `@raven/core` import with `type AiMatch`, `type ItemType`, `isMatchItemType`, `type MediaItem` and `type UnmatchedFile`; change `import { AiDecisions } from '@/metadata/aiDecisions'` to `import { AiDecisions, type DecisionPlace } from '@/metadata/aiDecisions'`; and import `filePlace` beside `groupPlaceOf` and `showPlace`.

Above the class, add:

```ts
/**
 * Where a matched file's group may keep its decision: a show's folder; a
 * movie's file, or its folder when that holds the one movie. The decision's
 * id must still be the item's, so a folder of several movies never claims one.
 */
const decisionPlacesOf = ({
  type,
  file,
}: {
  type: MatchItemType
  file: MatchFile
}): DecisionPlace[] => {
  if (type === 'show') return [{ libraryId: file.libraryId, place: showPlace(file) }]
  return [
    { libraryId: file.libraryId, place: filePlace(file) },
    ...(file.folder === '' ? [] : [{ libraryId: file.libraryId, place: file.folder }]),
  ]
}
```

Change `health()` to:

```ts
  health(): MetadataHealth {
    const tmdb = this.tmdb.state()
    return {
      tmdb: tmdb.state,
      omdb: this.omdb.state().state,
      pending: this.files.countPending(MATCHED_KINDS),
      error: tmdb.error,
      lastOk: tmdb.lastOk,
      ai: this.ai.state().state,
      aiRemaining: this.ai.remaining(),
    }
  }
```

After `health()`, add:

```ts
  /**
   * A library's files not matched, each with what the AI lookup suggests
   * for its group when it was not sure: kept at the place a Fix match on the
   * file would be. A pending file has none yet.
   */
  withSuggestions({
    libraryId,
    type,
    files,
  }: {
    libraryId: number
    type: MatchItemType
    files: readonly MediaItem[]
  }): UnmatchedFile[] {
    const placed = files.map((file) => ({
      file,
      place:
        file.match === 'unmatched'
          ? groupPlaceOf({
              type,
              file,
              folderFiles: () => this.files.inFolder({ libraryId, folder: file.folder }),
            })
          : null,
    }))
    const suggestions = this.decisions.suggestionsAt({
      libraryId,
      places: placed.flatMap(({ place }) => place ?? []),
    })
    return placed.map(({ file, place }) => ({
      ...file,
      aiSuggestion: place == null ? null : (suggestions.get(place) ?? null),
    }))
  }

  /**
   * Why the AI lookup matched a movie or show, being sure: its reason, when
   * one of the item's files that `sees` lets through is `matched` (not by
   * Fix match) and a sure decision for that file's group chose the item.
   * Null otherwise, and for a season or episode.
   */
  aiMatchFor({
    id,
    type,
    tmdbId,
    sees,
  }: {
    id: number
    type: ItemType
    tmdbId: string
    sees: (libraryId: number) => boolean
  }): AiMatch | null {
    if (!isMatchItemType(type)) return null
    const places = [
      ...new Map(
        this.files
          .under(id)
          .filter((file) => file.match === 'matched' && sees(file.libraryId))
          .flatMap((file) => decisionPlacesOf({ type, file }))
          .map((place) => [`${place.libraryId}|${place.place}`, place] as const),
      ).values(),
    ]
    const reason = this.decisions.highReason({ places, tmdbId })
    return reason == null ? null : { reason }
  }
```

In `apps/raven/server/src/libraries/librariesController.ts`, add `type UnmatchedFile` to the `@raven/core` import and change `listUnmatched`:

```ts
  /** Its files no movie or show was found for, or still waiting for matching, by title, each with the AI lookup's suggestion. */
  @Get(':id/unmatched')
  listUnmatched(@Param('id', ParseIntPipe) id: number): UnmatchedFile[] {
    const record = this.find(id)
    const type = matchTypeFor(record.settings.kind)
    if (type == null) return []
    return this.metadata.withSuggestions({
      libraryId: id,
      type,
      files: this.media.listUnmatched({ libraryId: id }),
    })
  }
```

In `apps/raven/server/src/items/itemsController.ts`, change `details`:

```ts
  /** The item's page, with only the files, children and AI note this browser may see. */
  private details({ id, cookie }: { id: number; cookie: string | undefined }): ItemDetails {
    const details = this.metadata.details(id)
    if (!details) throw new NotFoundException(`No item ${id}`)
    const viewer = this.lock.viewer({ cookie })
    return {
      ...details,
      aiMatch: this.service.aiMatchFor({
        id,
        type: details.type,
        tmdbId: details.tmdbId,
        sees: (libraryId) => viewer.seesLibrary(libraryId),
      }),
      versions: this.media.forItem(id).filter((item) => viewer.seesLibrary(item.libraryId)),
      children: itemChildren({ parentId: id, viewer, metadata: this.metadata, media: this.media }),
    }
  }
```

- [ ] **Step 8: Run them to verify they pass**

Run: `bunx nx run @raven/server:test` then `bunx nx run @raven/server:typecheck`, `bunx nx run @raven/core:test` and `bunx nx run @raven/web:typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add libs/raven/core/src/contract.ts libs/raven/core/src/contract.test.ts libs/raven/core/src/apiClient.ts libs/raven/core/src/apiClient.test.ts libs/raven/core/src/test/fixtures.ts apps/raven/server/src/metadata/aiDecisions.ts apps/raven/server/src/metadata/metadataService.ts apps/raven/server/src/metadata/metadataRepository.ts apps/raven/server/src/libraries/librariesController.ts apps/raven/server/src/items/itemsController.ts apps/raven/server/src/metadata/aiLookup.test.ts apps/raven/server/src/metadata/movies.test.ts apps/raven/web/src/test/fixtures.ts apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx apps/raven/web/src/pages/LibraryPage/LibraryPage.test.tsx
git commit -m "$(cat <<'EOF'
MAE: raven's API says what the AI lookup suggested and matched

- Not matched files carry `aiSuggestion`: an unsure pick's title, year, poster and reason
- Item details carry `aiMatch` when a sure pick matched it, for the files the viewer may see
- `MetadataHealth` gains `ai` and `aiRemaining`
EOF
)"
```

---

### Task 6: Document it, verify, and open the PR

**Files:**
- Modify: `apps/raven/README.md` (the Metadata section)

- [ ] **Step 1: Say how the lookup works**

In `apps/raven/README.md`'s Metadata section, after the **Fix match** bullet, add:

```
- **AI lookup.** With `ANTHROPIC_API_KEY` set (raven's own key), each show folder or movie a pass leaves not matched gets one lookup by Claude, Haiku 5.5 unless `AI_MATCH_MODEL` says otherwise. It searches TMDB itself, without the year when the folder's is wrong, checks a show's episode titles against the files', and answers with a TMDB id and how sure it is. A sure answer matches the files, and the page says **Matched by AI** with the reason; an unsure one stays under **Not matched** as a suggestion to accept or fix. Each folder is asked once; **Match again** asks again only where it chose nothing, and a Fix match always wins. raven counts its lookups (`AI_DAILY_LIMIT`, 200 by default, at most about 20 cents a day) and waits for midnight UTC. Claude is sent the library's type, the folder's name inside the library, up to 12 file names, what raven read from them and the searches it tried: never a full path, and nothing from Sporting events, YouTube videos or Other libraries. `/api/health` reports `metadata.ai` (`off`, `ok` or `failing`) and `aiRemaining`; the key never reaches the browser, the logs or the health check.
```

In the **Outbound calls** bullet, change `and, with a key, \`www.omdbapi.com\`` to `and, with their keys, \`www.omdbapi.com\` and \`api.anthropic.com\``.

- [ ] **Step 2: Run every check**

Run: `bun run verify`
Expected: every project passes spellcheck, lint, format, typecheck, tests and build. Fix what fails in the task it belongs to, with its own commit.

- [ ] **Step 3: Read the diff for the rules a linter misses**

Run: `git diff raven-smart-scan-types --stat`, then read the whole diff once for: an em or en dash (`grep -nP '[\x{2013}\x{2014}]'` over the changed files finds none), a positional second parameter, a `for` loop, a cast, an `||` default outside `config.ts`, a comment that restates the code, and any absolute path that could reach a request to Claude.

- [ ] **Step 4: Commit the README**

```bash
git add apps/raven/README.md
git commit -m "$(cat <<'EOF'
MAE: raven's README says how the AI lookup works

- What it is sent, what it decides, its daily limit and its health
EOF
)"
```

- [ ] **Step 5: Push and open the PR**

Push `raven-smart-scan-ai-server` and open the PR with base `raven-smart-scan-types`, following the `pr-format` skill: a `MAE:` title, `Stacked on #<step 3 PR>.` first, then What, Why and Testing by Nx project. The skill's no-attribution rule applies: call it "the AI lookup" in the title and body. Why: the spec's S3 outcome (six of nine leftovers matched for sure, three left for a person, about $0.001 a lookup). Follow-ups:
- put raven's own key in Vhagar's `/volume1/docker/raven/.env` (`deploy-raven-vhagar`);
- after deploy, the Not matched tab should hold only what the lookup marked low;
- step 5 adds the web: the dialog hint, suggestion cards and the note.
