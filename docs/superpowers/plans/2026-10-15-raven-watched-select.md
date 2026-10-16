# raven watched, step 3: select mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A viewer can select many cards and mark them watched or unwatched at once: from a Select button or a checkbox shown on hover, with shift-click ranges and a bar at the bottom that counts the selection and marks it.

**Architecture:**
- A vanilla zustand store per section or page (`createSelectionStore()`), put in context by `SelectionScope`, which is given `resolve(key) => WatchTarget[]` and `allKeys()` from the section's own data. Cards subscribe to `s.keys.has(key)` so one toggle redraws one card.
- Cards carry `data-entry` keys (`lib/entryKeys.ts`). Shift-click ranges go by DOM order with the selector `useScrollReset.ts` already uses, because `MediaList` sorts on the client and `MediaGroups` closes its buckets; **Select all** takes `allKeys()`.
- `useSelectable(key)` gives a card its checkbox props and an `onClickCapture` on the card root that prevents the click and toggles while selecting. `CardLink` and react-router's `Link` already leave a prevented click alone.
- `SelectionBar` marks the selection with `useWatchedChange` from step 2, in one request.

**Tech Stack:** React 19, zustand, TanStack Query, SCSS modules, bun test with happy-dom and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-15-raven-watched-design.md`: "What the viewer sees" (the select-mode bullets), "Web" (select mode), "Accessibility", the select items of "Testing", and "Order of work" step 3. It builds on step 2 (`2026-10-15-raven-watched-web.md`): `useWatchedChange`, `afterWatched`, `mutationKeys.watched`, and the marks on cards.

## Global Constraints

- Every rule in the root `CLAUDE.md` holds (no `any`, casts or non-null assertions outside tests; no `for` loops; named exports; one object parameter; `@/` imports with no extension; `&&` in JSX; no em or en dashes in code, comments or copy).
- CSS: SCSS modules, grid with `gap`, no flex, no margins, named `grid-template-areas`, tokens only, desktop-first at `30rem`, `40rem`, `48rem`, `64rem`, 320px works. Every animation or transition sits inside `@media (prefers-reduced-motion: no-preference)`; the bar's slide-in is one.
- Accessibility:
  - one tab stop per card in select mode, labelled "Select {title}"; outside select mode the hover checkbox has `tabIndex={-1}` so thousands of cards add no tab stops;
  - the count and outcome sit in a polite `<output>`; a failed mark is `role="alert"` and keeps the selection;
  - the checkbox shows on focus as well as hover; visible `:focus-visible` with `--focus-ring`;
  - Escape goes through `useKeyShortcut`, so an open menu or dialog takes it first, and focus returns to Select (`useReturnFocus`).
- The checkbox lives inside the card box: `content-visibility: auto` clips anything outside it.
- Copy, binding: "Select", "Select all", "Mark watched", "Mark unwatched", "Clear", "Done"; the bar is a `section` labelled "Selection"; the count reads "3 selected"; after a mark "Marked 12 watched" or "Marked 12 unwatched"; a failure "Could not mark. Try again."
- Run tasks through Nx from the repo root: `bunx nx run @raven/web:test`, one path with `-- <path>`, `typecheck`, `lint:ts`, `lint:css`, `format`, and `bun run verify` before the PR. Coverage stays above the floors in `apps/raven/web/package.json`.
- Commits follow the `commit-format` skill. Branch `raven-watched-select` from `raven-watched-web`; the PR is stacked on step 2's.

## Review Focus

- **A range in a client-sorted list**: shift-click selects the cards between the anchor and the click in the order shown, not data order. Pinned in Task 2.
- **Closed buckets**: shift-click skips cards inside a closed `<details>`; **Select all** includes them. Pinned in Task 2 and Task 3.
- **A click while selecting never navigates**; shift-click does not open a window. Pinned in Task 3.
- **Tab order**: one stop per card in select mode, none from the hover checkbox outside it. Pinned in Task 3.
- **After marking, the selection stays** and the other button reverses it. Pinned in Task 4.
- **Leaving ends it**: a tab change (the section remounts), Done and Escape. Pinned in Task 1 and Task 4.
- **Mixed kinds in one request**: a file sends a `media` target, a show or season card an `item` target, an episode row an `item` target with a null library, a saga its movies. Pinned in Task 5.

---

### Task 1: The selection store and scope

**Files:**
- Create: `apps/raven/web/src/stores/selection.ts`, `apps/raven/web/src/stores/selection.test.ts`
- Create: `apps/raven/web/src/components/SelectionScope/SelectionScope.tsx`, `SelectionScope.test.tsx`
- Modify: `apps/raven/web/src/lib/entryKeys.ts` (+ `entryKeys.test.ts`)

**Interfaces:**
- `createSelectionStore()` returns a vanilla zustand store of `{ selecting: boolean; keys: ReadonlySet<string>; anchor: string | null; start(key?: string): void; toggle(key: string): void; range(args: { to: string; ordered: readonly string[] }): void; selectAll(keys: readonly string[]): void; clear(): void; end(): void }`:
  - `start(key)` sets `selecting` and selects `key` (and the anchor) when given;
  - `toggle` flips one key and moves the anchor to it;
  - `range` selects every key of `ordered` from the anchor to `to` inclusive (the anchor alone if there is none);
  - `end` leaves select mode and empties the selection.
  - A new `Set` on every change, so subscribers redraw.
- `SelectionScope({ resolve, allKeys, children })`: creates one store per mount, provides `{ store, resolve, allKeys }` in context. Hooks: `useSelection(selector)` (subscribes to a slice of the scope's store), `useSelectionScope()` (the store and callbacks, or null outside a scope so cards render as they do today).
- `entryKeys.ts`: `seasonEntryKey(season)`, `episodeEntryKey(episode)`, `sagaEntryKey(saga)` beside `mediaEntryKey` and `showEntryKey`.

- [ ] **Step 1: Write the failing tests**
  - `selection.test.ts`: `starts with a card selected`; `toggles a key and moves the anchor`; `selects a range between the anchor and a key, either direction`; `selects the one key when there is no anchor`; `select all replaces the selection`; `end empties it and leaves select mode`; `a toggle gives a new set`.
  - `SelectionScope.test.tsx`: `a card outside any scope reads as not selecting`; `remounting the scope ends select mode`; `a card redraws only for its own key`.
  - `entryKeys.test.ts`: `names a season, an episode and a saga`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/stores/selection.test.ts src/components/SelectionScope src/lib/entryKeys.test.ts`
- [ ] **Step 3: Write the code.**
- [ ] **Step 4: Run them to see them pass**

---

### Task 2: `useSelectable` and the card checkbox

**Files:**
- Create: `apps/raven/web/src/lib/useSelectable.ts`, `useSelectable.test.tsx`
- Create: `apps/raven/web/src/components/SelectCheckbox/SelectCheckbox.tsx`, `SelectCheckbox.module.scss`, `SelectCheckbox.test.tsx`
- Modify: `apps/raven/web/src/lib/useScrollReset.ts` (export the entry selector as `ENTRY_SELECTOR` instead of repeating it)

**Interfaces:**
- `useSelectable({ key, title })` returns `{ selecting, selected, rootProps, checkboxProps }`:
  - `rootProps`: `onClickCapture` that, while selecting, calls `preventDefault` and `stopPropagation`; with `shiftKey` it calls `range({ to: key, ordered })` where `ordered` is the `data-entry` values from `document.querySelectorAll(ENTRY_SELECTOR)` in DOM order; otherwise `toggle(key)`. Outside select mode it does nothing, so the card opens as before.
  - `checkboxProps`: `checked`, `aria-label: Select ${title}`, `onChange` (starts select mode with the key outside it, toggles inside it), `tabIndex` `-1` outside select mode and `0` inside.
- `SelectCheckbox` is an `<input type="checkbox">` in the card box. Outside select mode it shows only under `@media (hover: hover)` on hover or focus within; in select mode it shows on every card.

- [ ] **Step 1: Write the failing tests**
  - `useSelectable.test.tsx`: `a click outside select mode is left alone`; `a click while selecting toggles and is prevented`; `shift-click selects a range in DOM order though the data is sorted the other way`; `shift-click skips cards in a closed details and select all does not`; `ticking the hover checkbox starts select mode with that card`.
  - `SelectCheckbox.test.tsx`: `is labelled Select with the title`; `is out of the tab order until selecting`; `is the card's one tab stop while selecting`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/lib/useSelectable.test.tsx src/components/SelectCheckbox`
- [ ] **Step 3: Write the code and styles** (the checkbox is placed by the card's grid area; selected cards get an outline from `--focus-ring`'s colour token, not a new one unless none fits).
- [ ] **Step 4: Run them to see them pass**

---

### Task 3: Wire the cards

**Files:**
- Modify: `components/PosterCard/PosterCard.tsx`, `MediaCard/MediaCard.tsx`, `MediaTiles/MediaTiles.tsx`, `MediaList/MediaList.tsx`, `ShowCard/ShowCard.tsx`, `ShowCard/ShowViews.tsx` (`ShowList`, `ShowTiles`), `SagaDeck/SagaDeck.tsx`, the season card, the episode row, and each card's `.module.scss`
- Test: each card's `*.test.tsx`

**Interfaces:**
- Each card root takes `rootProps` from `useSelectable`, renders `SelectCheckbox`, and while selecting: links take `tabIndex={-1}`, the play overlay and the menu trigger hide, so the checkbox is the card's one tab stop.
- `data-entry` is set from `lib/entryKeys.ts` on every card kind.

- [ ] **Step 1: Write the failing tests**, for each card kind:
  - `selects instead of opening while selecting`;
  - `leaves a click alone outside select mode`;
  - `hides its play button and menu while selecting`;
  - `MediaList` and `MediaGroups`: `shift-click follows the sorted order`, `closed buckets are skipped by a range`.
  - A tab-order test over a grid of three cards: `one stop each while selecting`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/components`
- [ ] **Step 3: Write the code.**
- [ ] **Step 4: Run them to see them pass; check at 320px by eye.**

---

### Task 4: `SelectionBar`

**Files:**
- Create: `apps/raven/web/src/components/SelectionBar/SelectionBar.tsx`, `SelectionBar.module.scss`, `SelectionBar.test.tsx`
- Create: `apps/raven/web/src/components/SelectButton/SelectButton.tsx` and its test (the Select button, `Button tone="quiet" icon="check"`, `aria-pressed` while selecting)

**Interfaces:**
- `SelectionBar()` reads the scope: renders nothing unless `selecting`. A `section` with an accessible name "Selection", sticky at the bottom of the main column, a grid that wraps to two rows below `30rem` and fits 320px. It holds a polite `<output>` with the count and the outcome, then **Select all** (`allKeys()`), **Mark watched** and **Mark unwatched** (both disabled with nothing selected), **Clear** and **Done**.
- Marking: `targets = [...keys].flatMap(resolve)`, in one `useWatchedChange` mutation (`watched: true | false`). On success the outcome reads "Marked N watched" and the selection stays; on failure a `role="alert"` message shows and the selection stays.
- Escape (through `useKeyShortcut`) and **Done** call `end()` and return focus to the Select button with `useReturnFocus`.
- The slide-in sits inside `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 1: Write the failing tests**
  - `says how many are selected, politely`;
  - `Select all selects every key the scope holds, closed buckets included`;
  - `Mark watched sends every selected card's targets in one request and says Marked 2 watched`;
  - `the selection stays after marking and Mark unwatched reverses it`;
  - `both marks are disabled with nothing selected`;
  - `a failed mark shows an alert and keeps the selection`;
  - `Clear empties the selection and stays in select mode`;
  - `Done and Escape end select mode and return focus to Select`;
  - `Escape goes to an open menu first`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/components/SelectionBar src/components/SelectButton`
- [ ] **Step 3: Write the code and styles.**
- [ ] **Step 4: Run them to see them pass**

---

### Task 5: Every section and page

**Files:**
- Modify: `pages/LibraryPage/LibraryPage.tsx`, `LibraryViews.tsx`, `SectionViews.tsx`, `components/LibraryToolbar/LibraryToolbar.tsx` (Select in the toolbar), `MediaGrid`, `MediaList`, `MediaTiles`, `MediaGroups`, `ShowCard/ShowViews.tsx` and the `EntryGrid` for In progress and Favourites, Recently finished (`MediaTiles`), Sagas (`SagaDecks`), `pages/SagaPage/SagaPage.tsx`, `pages/ShowPage/ShowPage.tsx` (season cards), `pages/SeasonPage/SeasonPage.tsx` (episode rows)
- Test: `LibraryPage.test.tsx`, `LibraryTabs.test.tsx`, `SagaPage.test.tsx`, `ShowPage.test.tsx`, `SeasonPage.test.tsx`

**Interfaces:**
- Each section or page wraps its cards in `SelectionScope` with:
  - `resolve(key)`: a file sends `{ kind: 'media', id }`; a show or season card `{ kind: 'item', id, libraryId }` (the library on library pages, null on the show page); an episode row `{ kind: 'item', id: episode.id, libraryId: null }`; a saga its movies as `item` targets in its library (`media` for one with no item).
  - `allKeys()`: every key in the section's data, so closed buckets count.
- **Select** sits in the library toolbar, in a small header on each other tab (In progress, Favourites, Recently finished, Sagas), and beside Play on the saga, show and season pages. `SelectionBar` renders once per scope.
- `LibraryPage` keys its sections by tab, so changing tab remounts the scope and ends select mode. Home, the History page, people pages and search results get none.

- [ ] **Step 1: Write the failing tests**
  - `Select in the toolbar starts select mode on All, and a card click selects`;
  - `each other tab has a Select that works the same`;
  - `changing tab ends select mode`;
  - `a mixed selection of a file and a show sends one request with a media and an item target`;
  - `an episode row selected sends an item target with a null library`;
  - `a saga selected sends its movies`;
  - `the show page's season cards and the season page's episode rows can be selected`;
  - `the page's Select button sits beside Play`.
- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/pages`
- [ ] **Step 3: Write the code.**
- [ ] **Step 4: Run them to see them pass**

---

### Task 6: README, the whole check and the commit

**Files:**
- Modify: `apps/raven/README.md` (a short "Marking watched" section: the Select button and hover checkbox, shift-click ranges, the bar and its buttons, Done and Escape, where it works and where it does not)

- [ ] **Step 1: Update the README.**
- [ ] **Step 2: Run everything**

Run: `bunx nx run @raven/web:test`, `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts`, `bunx nx run @raven/web:lint:css`, `bunx nx run @raven/web:format`, `bun run verify`.
Expected: all PASS, coverage above the floors.
- [ ] **Step 3: Look at it**: run the app (`run` skill), select a range in a sorted list at desktop width and at 320px, mark 12 at once, check the tab order with the keyboard; add screenshots to the PR per `pr-format`.
- [ ] **Step 4: Commit**

```bash
git add apps docs
git commit -F - <<'MSG'
MAE: raven selects many cards to mark them watched at once

- a vanilla zustand selection store, `useSelectable` and a card checkbox
- shift-click ranges by DOM order, a `SelectionBar` at the foot of the page
- Select on every library tab and the saga, show and season pages
MSG
```
