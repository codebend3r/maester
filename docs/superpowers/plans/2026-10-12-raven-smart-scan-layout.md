# raven smart scan, step 2: folder layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** raven reads letter folders (`A/`, `#/`) and group folders (`Requests/`) as containers whose children are the titles. Each show under `A/` becomes its own show, and the libraries already indexed the old way are put right on the next boot.

**Architecture:**
- `@raven/core` gains pure rules that say, from one file's relative folder, which top folder groups titles (`groupFolderOf`).
- The scanner gives each found file a title root (`<library path>/<group folder>`), so `media.folder` and everything downstream of it (show grouping, pictures, NFOs, Fix match places) work unchanged.
- A relayout re-derives title roots for rows already in the database. It runs on every boot, which is safe because it touches only rows whose folder changes, and also when the new `folderLayout` setting or the library's type changes. It moves Fix match places along, and sends regrouped show files back to matching.

**Tech Stack:** NestJS 12, vitest and better-sqlite3 (server); `@raven/core` schema combinators and bun test (core); React 19 and bun test with happy-dom (web).

**Spec:** `docs/superpowers/specs/2026-10-12-raven-smart-scan-design.md`, section 1 ("Folder layout"), the S1 and S2 outcomes, and "Order of work" step 2.

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
- `libs/raven/core` stays free of DOM and Node APIs: no `node:path` there.
- New API shapes are guards in `libs/raven/core/src/contract.ts` built from the `schema.ts` combinators, with their types read off the guards.
- Server constructors inject with explicit `@Inject(Token)`.
- Run tasks through Nx from the repo root:
  - `bunx nx run @raven/core:test`, `bunx nx run @raven/server:test` and `bunx nx run @raven/web:test`;
  - one file at a time with `-- <path>`, as in `bunx nx run @raven/server:test -- src/scanner/layout.test.ts`;
  - `bun run verify` before the PR.
- Commits follow the `commit-format` skill: a `MAE:` subject, a short bullet body, and no agent attribution.
- Branch `raven-smart-scan-layout` from `smart-scan`, which holds the spec. The PR is stacked on the spec PR.
- Never edit a shipped migration. This step appends migration 19. If the transcoding S1 migration (`probe_version`) lands first, append after it.
- Libraries that are never matched (Other, Sports, YouTube) never read containers. Their rows must not change.

## Deviations from the spec, on purpose

- **`isLetterFolder` lives in `folderLayout.ts`, not in `naming.ts`.** It sits with the rules that use it.
- **One letter rule for TV and movies.** A letter folder is a container unless the folder right after it is a season folder, so `K/Season 1/` stays the show K. A loose episode in `A/` is read from its own name, never as a show called "A".
- **No boot marker.** Relayout runs on every boot. It only touches rows whose folder changes, so a steady library costs one read of its rows and no writes.
- **Path layouts are `flat`, `lettered` or `grouped`**, with a count of group folders, not `mixed`. They are written after each full scan, and only for readable paths.

## Review Focus

1. **A flat path, or a library that is never matched, is untouched on upgrade.** That covers Home Videos and Tutorials, which have letter folders but are Other libraries. Boot's relayout moves no row there and drops no Fix match. Pinned in Task 4 (`planRelayout` with flat rows and with an `other` library).
2. **A new episode lands inside a letter folder while the watcher is running** (`A/Andor/Season 2/`). The place refresh files it as `Andor/Season 2` under Andor, exactly as a full scan would. Pinned in Task 3 (refresh test).
3. **Fix match on one show under a letter folder, after the upgrade, re-points only that show,** never every show under `A/`. Pinned in Task 3 (Fix match test).
4. **A loose episode file directly inside a TV letter folder** (`A/Andor - S01E01.mkv`) is matched by its own name, not as a show called "A". Pinned in Task 1 (`groupFolderOf` table) and Task 3 (end to end).
5. **A Fix match saved before the upgrade on a movie folder** (`A/Alien (1979)`, or "not a movie") still applies once the folder reads `Alien (1979)`. Pinned in Task 4 (relayout database test).

---

## Files

| File | Change |
| --- | --- |
| `libs/raven/core/src/contract.ts` | `isFolderLayout`, `isPathLayout`, `isLibraryPathLayout`; `LibrarySettings.folderLayout`; `Library.layouts`; the `MediaItem.folder` comment |
| `libs/raven/core/src/naming.ts` | export `yearOf` |
| `libs/raven/core/src/folderLayout.ts` (new) | `isLetterFolder`, `groupFolderOf`, `describeLayout` |
| `libs/raven/core/src/folderLayout.test.ts` (new) | the rules' tables |
| `libs/raven/core/src/index.ts` | export `@/folderLayout` |
| `libs/raven/core/src/libraryKinds.ts` | `DEFAULT_LIBRARY_SETTINGS.folderLayout` |
| `libs/raven/core/src/libraryInput.ts` | `SETTING_PROBLEMS.folderLayout` |
| `libs/raven/core/src/test/fixtures.ts`, `apps/raven/web/src/test/fixtures.ts` | the new setting and `layouts` |
| `apps/raven/server/src/db/database.ts` | migration 19 |
| `apps/raven/server/src/db/database.test.ts` | migration test |
| `apps/raven/server/src/libraries/librariesRepository.ts` | the setting's column; `layouts` on records; `saveLayouts` |
| `apps/raven/server/src/libraries/librariesController.ts` | `layouts` hidden while locked; layout change runs a relayout |
| `apps/raven/server/src/scanner/layout.ts` (new) | `titleRootOf`, `withTitleRoots`, `layoutsOf`, `planRelayout` |
| `apps/raven/server/src/scanner/layout.test.ts` (new) | pure tests |
| `apps/raven/server/src/scanner/scannerService.ts` | title roots in `reindex`; layouts saved after a full scan |
| `apps/raven/server/src/metadata/matchFiles.ts` | `layoutRows`, `overridePlaces`, `applyRelayout` |
| `apps/raven/server/src/metadata/metadataService.ts` | `relayoutNow` on boot, `changeLayout`, relayout inside `changeKind` |
| `apps/raven/server/src/metadata/relayout.test.ts` (new) | relayout against a real database |
| `apps/raven/server/src/metadata/letterFolders.test.ts` (new) | end to end, lettered TV and movie libraries |
| `apps/raven/server/src/libraries/librariesRepository.test.ts` (new) | the setting and path layouts, round trip |
| `apps/raven/server/src/app.test.ts`, `apps/raven/web/src/components/LibraryDialog/LibraryDialog.test.tsx` | full settings literals gain `folderLayout` |
| `apps/raven/web/src/components/LibraryDialog/LibraryDialog.tsx` and `.module.scss` | the Folder layout checkbox and what each path was read as |
| `apps/raven/README.md` | how scanning reads letter and group folders |

---

### Task 1: The container rules in core

**Files:**
- Modify: `libs/raven/core/src/contract.ts` (after `RATING_SOURCES`, around line 172)
- Modify: `libs/raven/core/src/naming.ts` (after `readName`, around line 188)
- Create: `libs/raven/core/src/folderLayout.ts`
- Create: `libs/raven/core/src/folderLayout.test.ts`
- Modify: `libs/raven/core/src/index.ts`

**Interfaces:**
- Consumes: `seasonFolderNumber` (`naming.ts`), `matchTypeFor` (`libraryKinds.ts`), `oneOf`, `object`, `nullable`, `isString`, `isNumber` (`schema.ts`).
- Produces:
  - `isFolderLayout`, `type FolderLayout = 'auto' | 'flat'`, `FOLDER_LAYOUTS`;
  - `isPathLayout`, `type PathLayout = 'flat' | 'lettered' | 'grouped'`;
  - `isLibraryPathLayout`, `type LibraryPathLayout = { path: string; layout: PathLayout | null; groups: number }`;
  - `yearOf(name: string): number | null`;
  - `isLetterFolder(name: string): boolean`;
  - `groupFolderOf({ kind, folder, layout }: { kind: LibraryKind; folder: string; layout: FolderLayout }): string | null`;
  - `describeLayout(groupFolders: readonly string[]): PathLayout`.

- [ ] **Step 1: Write the failing tests**

Create `libs/raven/core/src/folderLayout.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { describeLayout, groupFolderOf, isLetterFolder } from '@/folderLayout'

describe('isLetterFolder', () => {
  it.each(['A', 'z', '#', '0-9', 'A-C', 'a - c'])('reads %s as a letter folder', (name) => {
    expect(isLetterFolder(name)).toBe(true)
  })

  it.each(['AB', 'Andor', 'Requests', '1', 'A-', 'Season 1', ''])('reads %s as a name', (name) => {
    expect(isLetterFolder(name)).toBe(false)
  })
})

describe('groupFolderOf', () => {
  const shows = (folder: string) => groupFolderOf({ kind: 'animeShows', folder, layout: 'auto' })
  const movies = (folder: string) => groupFolderOf({ kind: 'movies', folder, layout: 'auto' })

  it('reads a letter folder of shows as a container', () => {
    expect(shows('A/Andor/Season 1')).toBe('A')
    expect(shows('#/13 Reasons Why/Season 1')).toBe('#')
    expect(shows('A-C/Andor/Season 1')).toBe('A-C')
  })

  it('keeps a show named with one letter, whose season folders sit right under it', () => {
    expect(shows('K/Season 1')).toBeNull()
    expect(shows('K/Specials')).toBeNull()
    expect(shows('K/K/Season 1')).toBe('K')
  })

  it('reads a loose episode in a letter folder from its own name', () => {
    expect(shows('A')).toBe('A')
  })

  it('reads a folder of shows, each with seasons, as a container', () => {
    expect(shows('Requests/Cupertino/Season 1')).toBe('Requests')
    expect(shows('Star Trek/Star Trek - The Next Generation/Season 1')).toBe('Star Trek')
  })

  it('keeps an ordinary show folder, with or without season folders', () => {
    expect(shows('Andor/Season 1')).toBeNull()
    expect(shows('Fargo')).toBeNull()
    expect(shows('Severance (2022)/Featurettes')).toBeNull()
    expect(shows('')).toBeNull()
  })

  it('reads a letter folder of movies as a container, loose movies included', () => {
    expect(movies('A/Alien (1979)')).toBe('A')
    expect(movies('H')).toBe('H')
    expect(movies('#/2001 A Space Odyssey (1968)')).toBe('#')
  })

  it('reads a folder with no year that holds movie folders with years as a container', () => {
    expect(movies('Requests/25th Hour (2002)')).toBe('Requests')
    expect(movies('_Trash_Review/Horizon (2024)')).toBe('_Trash_Review')
  })

  it('keeps a movie folder and its extras', () => {
    expect(movies('Alien (1979)')).toBeNull()
    expect(movies('Alien (1979)/Featurettes')).toBeNull()
    expect(movies('S/Season of the Witch (2011)')).toBe('S')
    expect(movies('_Trash_Review')).toBeNull()
  })

  it('reads nothing as a container in a flat layout, or in a library that is never matched', () => {
    expect(groupFolderOf({ kind: 'shows', folder: 'A/Andor/Season 1', layout: 'flat' })).toBeNull()
    expect(groupFolderOf({ kind: 'other', folder: 'A/Clip', layout: 'auto' })).toBeNull()
    expect(groupFolderOf({ kind: 'sports', folder: 'Requests/UFC 300 (2024)', layout: 'auto' })).toBeNull()
  })
})

describe('describeLayout', () => {
  it('names a path by its group folders', () => {
    expect(describeLayout([])).toBe('flat')
    expect(describeLayout(['A', 'B', 'A', 'Requests'])).toBe('lettered')
    expect(describeLayout(['Requests', 'Star Trek', 'A'])).toBe('grouped')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx nx run @raven/core:test -- src/folderLayout.test.ts`
Expected: FAIL, `Cannot find module '@/folderLayout'`.

- [ ] **Step 3: Add the guards to the contract**

In `libs/raven/core/src/contract.ts`, after `export const RATING_SOURCES = isRatingSource.values`:

```ts
/**
 * How a library's folders are read: `auto` reads letter folders (`A/`, `#/`)
 * and group folders (`Requests/`) as holding the titles; `flat` reads every
 * top folder as one title.
 */
export const isFolderLayout = oneOf(['auto', 'flat'])

export type FolderLayout = Infer<typeof isFolderLayout>

export const FOLDER_LAYOUTS = isFolderLayout.values

/** What a library path turned out to be on its last full scan. */
export const isPathLayout = oneOf(['flat', 'lettered', 'grouped'])

export type PathLayout = Infer<typeof isPathLayout>

/** One library path, how it was read, and how many group folders it holds. */
export const isLibraryPathLayout = object({
  path: isString,
  /** null until a full scan has read the path. */
  layout: nullable(isPathLayout),
  groups: isNumber,
})

export type LibraryPathLayout = Infer<typeof isLibraryPathLayout>
```

- [ ] **Step 4: Export `yearOf` from `naming.ts`**

In `libs/raven/core/src/naming.ts`, directly after `readName`:

```ts
/** The year a folder or file name gives, as the title parser reads it, or null. */
export const yearOf = (name: string): number | null => readName(name).year
```

- [ ] **Step 5: Write `folderLayout.ts`**

Create `libs/raven/core/src/folderLayout.ts`:

```ts
import type { FolderLayout, LibraryKind, PathLayout } from '@/contract'
import { matchTypeFor } from '@/libraryKinds'
import { seasonFolderNumber, yearOf } from '@/naming'

/** A letter folder: one letter, `#`, `0-9`, or a run of letters such as `A-C`. */
export const isLetterFolder = (name: string): boolean =>
  /^(?:[a-z]|#|0-9|[a-z]\s*-\s*[a-z])$/i.test(name.trim())

const isSeasonFolder = (name: string | undefined): boolean =>
  name != null && seasonFolderNumber(name) != null

/**
 * The top folder of a file's place when it groups titles rather than being
 * one, so the titles are the folders inside it; null when the top folder is
 * the title. Read from the file's own folder alone, so a full scan and a
 * refresh of one place agree.
 *
 * - A letter folder groups titles, unless a season folder sits right under
 *   it: `K/Season 1` is the show K.
 * - In a TV library, a folder whose shows hold the season folders groups
 *   them: `Requests/Cupertino/Season 1`.
 * - In a movie library, a folder with no year that holds folders with years
 *   groups them: `Requests/25th Hour (2002)`.
 *
 * A library that is never matched, or one set to `flat`, has none.
 */
export const groupFolderOf = ({
  kind,
  folder,
  layout,
}: {
  kind: LibraryKind
  folder: string
  layout: FolderLayout
}): string | null => {
  const type = matchTypeFor(kind)
  if (layout === 'flat' || type == null) return null
  const [top, second, third] = folder.split(/[\\/]/).filter((segment) => segment !== '')
  if (top == null) return null
  if (isLetterFolder(top)) return isSeasonFolder(second) ? null : top
  if (second == null) return null
  if (type === 'show') return !isSeasonFolder(second) && isSeasonFolder(third) ? top : null
  return yearOf(top) == null && yearOf(second) != null ? top : null
}

/** What a library path is, from the group folders its files were found in. */
export const describeLayout = (groupFolders: readonly string[]): PathLayout => {
  const distinct = [...new Set(groupFolders)]
  if (distinct.length === 0) return 'flat'
  return distinct.filter(isLetterFolder).length * 2 >= distinct.length ? 'lettered' : 'grouped'
}
```

In `libs/raven/core/src/index.ts`, add `export * from '@/folderLayout'` in alphabetical order, after `@/contract`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `bunx nx run @raven/core:test -- src/folderLayout.test.ts`
Expected: PASS.

Run: `bunx nx run @raven/core:test`
Expected: PASS. Nothing else uses the new exports yet.

- [ ] **Step 7: Commit**

```bash
git add libs/raven/core/src/contract.ts libs/raven/core/src/naming.ts libs/raven/core/src/folderLayout.ts libs/raven/core/src/folderLayout.test.ts libs/raven/core/src/index.ts
git commit -m "$(cat <<'EOF'
MAE: raven core reads letter and group folders as containers

- `groupFolderOf` says which top folder holds titles, from one file's folder
- `isLetterFolder`, `describeLayout`, `yearOf`
- `FolderLayout`, `PathLayout` and `LibraryPathLayout` guards
EOF
)"
```

---

### Task 2: The `folderLayout` setting and each path's layout, stored

**Files:**
- Modify: `libs/raven/core/src/contract.ts` (`isLibrarySettings`, `isLibrary`)
- Modify: `libs/raven/core/src/libraryKinds.ts` (`DEFAULT_LIBRARY_SETTINGS`)
- Modify: `libs/raven/core/src/libraryInput.ts` (`SETTING_PROBLEMS`)
- Modify: `libs/raven/core/src/test/fixtures.ts`, `apps/raven/web/src/test/fixtures.ts`
- Modify: `apps/raven/server/src/db/database.ts` (append to `MIGRATIONS`)
- Modify: `apps/raven/server/src/libraries/librariesRepository.ts`
- Modify: `apps/raven/server/src/libraries/librariesController.ts` (`withStatus`)
- Create: `apps/raven/server/src/libraries/librariesRepository.test.ts`
- Test: `apps/raven/server/src/db/database.test.ts`, `apps/raven/server/src/app.test.ts`, `apps/raven/web/src/components/LibraryDialog/LibraryDialog.test.tsx`

**Interfaces:**
- Consumes: `isFolderLayout`, `isLibraryPathLayout`, `LibraryPathLayout` (Task 1).
- Produces:
  - `LibrarySettings.folderLayout: FolderLayout`, `'auto'` by default;
  - `Library.layouts: LibraryPathLayout[]`, in path order;
  - `LibraryRecord.layouts: LibraryPathLayout[]`;
  - `LibrariesRepository.saveLayouts({ id, layouts }: { id: number; layouts: ReadonlyArray<{ path: string; layout: PathLayout; groups: number }> }): void`.

- [ ] **Step 1: Write the failing migration test**

In `apps/raven/server/src/db/database.test.ts`, inside `describe('migrations', ...)`, after the last `it`:

```ts
  it('gives a library made before folder layouts the auto layout, and its paths none yet', () => {
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, 18).forEach((sql) => before.exec(sql))
    before.pragma('user_version = 18')
    before.exec(
      "INSERT INTO libraries (name, created_at) VALUES ('Anime', '2026-01-01T00:00:00.000Z')",
    )
    before.exec("INSERT INTO library_paths (library_id, path, position) VALUES (1, '/media/Anime', 0)")
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT folder_layout FROM libraries').get()).toEqual({
      folder_layout: 'auto',
    })
    expect(database.db.prepare('SELECT layout, group_folders FROM library_paths').get()).toEqual({
      layout: null,
      group_folders: 0,
    })
    database.onModuleDestroy()
  })
```

- [ ] **Step 2: Run it to see it fail**

Run: `bunx nx run @raven/server:test -- src/db/database.test.ts`
Expected: FAIL, `no such column: folder_layout`.

- [ ] **Step 3: Append migration 19**

In `apps/raven/server/src/db/database.ts`, append before the closing `]` of `MIGRATIONS`:

```ts
  // How a library's folders are read: 'auto' reads letter folders (A/, #/)
  // and group folders (Requests/) as holding the titles, 'flat' reads every
  // top folder as a title. Each path keeps what its last full scan found:
  // 'flat', 'lettered' or 'grouped', and how many group folders.
  `
  ALTER TABLE libraries ADD COLUMN folder_layout TEXT NOT NULL DEFAULT 'auto';
  ALTER TABLE library_paths ADD COLUMN layout TEXT;
  ALTER TABLE library_paths ADD COLUMN group_folders INTEGER NOT NULL DEFAULT 0;
  `,
```

Run: `bunx nx run @raven/server:test -- src/db/database.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the setting and the layouts to the contract**

In `libs/raven/core/src/contract.ts`, inside `isLibrarySettings`, after `locked`:

```ts
  /** Read letter and group folders as holding the titles (`auto`), or every top folder as one title (`flat`). */
  folderLayout: isFolderLayout,
```

Inside `isLibrary`, after `paths`:

```ts
  /** How each path was read on its last full scan, in path order. None while the library is locked to this browser. */
  layouts: listOf(isLibraryPathLayout),
```

`isFolderLayout` and `isLibraryPathLayout` are declared above `isLibrarySettings` (Task 1), so the order holds.

In `libs/raven/core/src/libraryKinds.ts`, add `folderLayout: 'auto',` to `DEFAULT_LIBRARY_SETTINGS` after `locked: false,`.

In `libs/raven/core/src/libraryInput.ts`, add to `SETTING_PROBLEMS` after `locked`:

```ts
  folderLayout: 'Folder layout is not one of the choices.',
```

- [ ] **Step 5: Store the setting and read the layouts**

In `apps/raven/server/src/libraries/librariesRepository.ts`:

- `LibraryRecord` gains `layouts: LibraryPathLayout[]` after `paths`, with `LibraryPathLayout` and `PathLayout` imported from `@raven/core`.
- `LibraryRow` gains `folder_layout: string`.
- `toSettings`'s `stored` gains `folderLayout: row.folder_layout,`.
- `settingParams` gains `folder_layout: settings.folderLayout,`.
- `PathRow` becomes:

```ts
type PathRow = {
  library_id: number
  path: string
  layout: string | null
  group_folders: number
}
```

- `rows()` selects `SELECT library_id, path, layout, group_folders FROM library_paths ...` and maps each record with:

```ts
      layouts: paths
        .filter((path) => path.library_id === row.id)
        .map((path) => ({
          path: path.path,
          layout: isPathLayout(path.layout) ? path.layout : null,
          groups: path.group_folders,
        })),
```

Import `isPathLayout` from `@raven/core`. Keep the existing `paths:` mapping as it is.

- Add this method after `get`:

```ts
  /** What a full scan found each readable path to be; paths it could not read keep what they had. */
  saveLayouts({
    id,
    layouts,
  }: {
    id: number
    layouts: ReadonlyArray<{ path: string; layout: PathLayout; groups: number }>
  }): void {
    const update = this.db.prepare(
      'UPDATE library_paths SET layout = ?, group_folders = ? WHERE library_id = ? AND path = ?',
    )
    this.db.transaction(() => {
      layouts.forEach(({ path, layout, groups }) => update.run(layout, groups, id, path))
    })()
  }
```

`replacePaths` deletes and re-inserts, so a changed path starts with `layout` NULL, which is right.

In `apps/raven/server/src/libraries/librariesController.ts`, in `withStatus`'s locked branch, add `layouts: [],` beside `paths: [],`.

- [ ] **Step 6: Update the fixtures and the full settings literals**

- In `libs/raven/core/src/test/fixtures.ts` and `apps/raven/web/src/test/fixtures.ts`, add `folderLayout: 'auto'` beside `locked: false` in every settings object.
- In their library fixtures, add `layouts: [{ path: <the fixture's first path>, layout: 'flat', groups: 0 }]` beside `paths`. Match the fixture's own path list, one entry per path.

Then find every full settings literal the tests compare against:

Run: `grep -rn "ratingsSource: 'tmdb'," apps/raven/server/src apps/raven/web/src libs/raven/core/src`

Add `folderLayout: 'auto',` after `locked: ...` in each literal in `apps/raven/server/src/app.test.ts` and `apps/raven/web/src/components/LibraryDialog/LibraryDialog.test.tsx`, so each `toEqual` matches the new default.

- [ ] **Step 7: Write the repository round trip**

Create `apps/raven/server/src/libraries/librariesRepository.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { testDatabase } from '@/test/database'

describe('libraries', () => {
  const database = testDatabase('raven-libraries-')
  beforeAll(database.open)
  afterAll(database.close)

  it("keeps a library's folder layout, and starts its paths unread", () => {
    const libraries = new LibrariesRepository(database.get())
    const created = libraries.create({
      name: 'Anime',
      paths: ['/media/Anime', '/media/Classics'],
      settings: { kind: 'animeShows', folderLayout: 'flat' },
    })
    expect(created.settings.folderLayout).toBe('flat')
    expect(created.layouts).toEqual([
      { path: '/media/Anime', layout: null, groups: 0 },
      { path: '/media/Classics', layout: null, groups: 0 },
    ])
  })

  it('keeps what a full scan found each path to be, until the paths change', () => {
    const libraries = new LibrariesRepository(database.get())
    const { id } = libraries.create({ name: 'TV', paths: ['/media/TV'], settings: { kind: 'shows' } })
    expect(libraries.get(id)?.settings.folderLayout).toBe('auto')
    libraries.saveLayouts({ id, layouts: [{ path: '/media/TV', layout: 'lettered', groups: 27 }] })
    expect(libraries.get(id)?.layouts).toEqual([{ path: '/media/TV', layout: 'lettered', groups: 27 }])
    libraries.update({ id, input: { name: 'TV', paths: ['/media/Shows'] } })
    expect(libraries.get(id)?.layouts).toEqual([{ path: '/media/Shows', layout: null, groups: 0 }])
  })
})
```

`LibrariesRepository.update` takes `{ id, input }` as the controller calls it. If its `input` type needs `settings`, pass `settings: {}`.

Run: `bunx nx run @raven/server:test -- src/libraries/librariesRepository.test.ts`
Expected: PASS once Steps 3 to 5 are in.

- [ ] **Step 8: Run every suite**

Run: `bunx nx run @raven/core:test` then `bunx nx run @raven/server:test` then `bunx nx run @raven/web:test`
Expected: all PASS. A failure naming `folderLayout` or `layouts` means a fixture or literal from Step 6 was missed.

- [ ] **Step 9: Commit**

```bash
git add libs/raven/core/src apps/raven/server/src/db apps/raven/server/src/libraries apps/raven/server/src/app.test.ts apps/raven/web/src/test/fixtures.ts apps/raven/web/src/components/LibraryDialog/LibraryDialog.test.tsx
git commit -m "$(cat <<'EOF'
MAE: raven libraries keep a folder layout setting and each path's layout

- `LibrarySettings.folderLayout`, `auto` by default; `Library.layouts`
- migration 19: `libraries.folder_layout`, `library_paths.layout` and `group_folders`
- `LibrariesRepository.saveLayouts`; layouts hidden while locked
EOF
)"
```

---

### Task 3: Title roots in the scanner

**Files:**
- Create: `apps/raven/server/src/scanner/layout.ts`
- Create: `apps/raven/server/src/scanner/layout.test.ts`
- Modify: `apps/raven/server/src/scanner/scannerService.ts` (`reindex`, around lines 272 to 301)
- Modify: `libs/raven/core/src/contract.ts` (the `MediaItem.folder` comment)
- Create: `apps/raven/server/src/metadata/letterFolders.test.ts`
- Modify: `apps/raven/README.md` (the scanning section, around line 176)

**Interfaces:**
- Consumes:
  - `groupFolderOf`, `describeLayout`, `FolderLayout`, `LibraryKind`, `PathLayout` (Task 1);
  - `LibrariesRepository.saveLayouts` (Task 2);
  - `FoundFile` and `isUnder` (`scanner/walk.ts`);
  - `showDirOf` (`metadata/places.ts`), used in tests.
- Produces:
  - `titleRootOf({ root, path, kind, layout }: { root: string; path: string; kind: LibraryKind; layout: FolderLayout }): string`;
  - `withTitleRoots({ files, kind, layout }: { files: readonly FoundFile[]; kind: LibraryKind; layout: FolderLayout }): FoundFile[]`;
  - `layoutsOf({ roots, files, kind, layout }: { roots: readonly string[]; files: readonly FoundFile[]; kind: LibraryKind; layout: FolderLayout }): Array<{ path: string; layout: PathLayout; groups: number }>`.

  `files` here are the walk's own, rooted at library paths.

- [ ] **Step 1: Write the failing pure tests**

Create `apps/raven/server/src/scanner/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { showDirOf } from '@/metadata/places'
import { layoutsOf, titleRootOf, withTitleRoots } from '@/scanner/layout'
import type { FoundFile } from '@/scanner/walk'

const found = (path: string, root: string): FoundFile => ({ path, root, size: 1, mtimeMs: 1 })

describe('title roots', () => {
  it('roots a show under its letter folder, and a flat show at the library path', () => {
    expect(
      titleRootOf({ root: '/m/TV', path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', kind: 'shows', layout: 'auto' }),
    ).toBe('/m/TV/A')
    expect(
      titleRootOf({ root: '/m/TV', path: '/m/TV/Andor/Season 1/Andor - S01E01.mkv', kind: 'shows', layout: 'auto' }),
    ).toBe('/m/TV')
    expect(
      titleRootOf({ root: '/m/TV', path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', kind: 'shows', layout: 'flat' }),
    ).toBe('/m/TV')
  })

  it('leaves a file at the library path where it is', () => {
    expect(titleRootOf({ root: '/m/TV', path: '/m/TV/Pilot.mkv', kind: 'shows', layout: 'auto' })).toBe('/m/TV')
  })

  it('looks for a show\'s poster in its own folder under the letter', () => {
    const [file] = withTitleRoots({
      files: [found('/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', '/m/TV')],
      kind: 'shows',
      layout: 'auto',
    })
    expect(file?.root).toBe('/m/TV/A')
    expect(
      showDirOf({ path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', folder: 'Andor/Season 1', fileName: 'Andor - S01E01.mkv' }),
    ).toBe('/m/TV/A/Andor')
  })

  it('describes each library path by the group folders its files sit in', () => {
    expect(
      layoutsOf({
        roots: ['/m/TV', '/m/Reality'],
        files: [
          found('/m/TV/A/Andor/Season 1/a.mkv', '/m/TV'),
          found('/m/TV/B/Bluey/Season 1/b.mkv', '/m/TV'),
          found('/m/TV/Requests/Cupertino/Season 1/c.mkv', '/m/TV'),
          found('/m/Reality/Alone/Season 1/d.mkv', '/m/Reality'),
        ],
        kind: 'shows',
        layout: 'auto',
      }),
    ).toEqual([
      { path: '/m/TV', layout: 'lettered', groups: 3 },
      { path: '/m/Reality', layout: 'flat', groups: 0 },
    ])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/scanner/layout.test.ts`
Expected: FAIL, `Cannot find module '@/scanner/layout'`.

- [ ] **Step 3: Write `layout.ts`**

Create `apps/raven/server/src/scanner/layout.ts`:

```ts
import { dirname, join, relative } from 'node:path'
import {
  type FolderLayout,
  type LibraryKind,
  type PathLayout,
  describeLayout,
  groupFolderOf,
} from '@raven/core'
import type { FoundFile } from '@/scanner/walk'

/**
 * The folder a file's titles sit in: its library path, or the letter or
 * group folder under it that holds the titles. `media.folder` is measured
 * from here, so grouping, pictures and Fix match see `Andor/Season 1`, never
 * `A/Andor/Season 1`.
 */
export const titleRootOf = ({
  root,
  path,
  kind,
  layout,
}: {
  root: string
  path: string
  kind: LibraryKind
  layout: FolderLayout
}): string => {
  const group = groupFolderOf({ kind, folder: relative(root, dirname(path)), layout })
  return group == null ? root : join(root, group)
}

/** The walk's files, each rooted at the folder its titles sit in. */
export const withTitleRoots = ({
  files,
  kind,
  layout,
}: {
  files: readonly FoundFile[]
  kind: LibraryKind
  layout: FolderLayout
}): FoundFile[] =>
  files.map((file) => ({ ...file, root: titleRootOf({ root: file.root, path: file.path, kind, layout }) }))

/** What each library path is, from the walk's files rooted at their library paths. */
export const layoutsOf = ({
  roots,
  files,
  kind,
  layout,
}: {
  roots: readonly string[]
  files: readonly FoundFile[]
  kind: LibraryKind
  layout: FolderLayout
}): Array<{ path: string; layout: PathLayout; groups: number }> =>
  roots.map((root) => {
    const groups = files
      .filter((file) => file.root === root)
      .flatMap((file) => groupFolderOf({ kind, folder: relative(root, dirname(file.path)), layout }) ?? [])
    return { path: root, layout: describeLayout(groups), groups: new Set(groups).size }
  })
```

Run: `bunx nx run @raven/server:test -- src/scanner/layout.test.ts`
Expected: PASS.

- [ ] **Step 4: Root the walk's files in `reindex`, and save the layouts after a full scan**

In `apps/raven/server/src/scanner/scannerService.ts`, import `layoutsOf` and `withTitleRoots` from `@/scanner/layout`. In `reindex`, replace

```ts
    const changes = reconcile({ known, found: walk.files })
```

with

```ts
    const { kind, folderLayout } = library.settings
    // Each file is filed under the folder its titles sit in, a letter folder
    // or a group folder when its path has one, before anything reads it.
    const changes = reconcile({
      known,
      found: withTitleRoots({ files: walk.files, kind, layout: folderLayout }),
    })
    if (scope.kind === 'library') {
      this.libraries.saveLayouts({
        id: library.id,
        layouts: layoutsOf({
          roots: library.paths.filter((path) => !walk.unreadable.includes(path)),
          files: walk.files,
          kind,
          layout: folderLayout,
        }),
      })
    }
```

`reconcile` matches files by path, and `MediaIndex.insert` and `move` derive `folder` from `file.root` through `placeOf`, so nothing else in the scan changes.

In `libs/raven/core/src/contract.ts`, change the `MediaItem.folder` comment to:

```ts
  /** The folder the file sits in, under the folder its titles sit in (its library path, or a letter or group folder there); '' there. */
```

- [ ] **Step 5: Write the failing end-to-end test**

Create `apps/raven/server/src/metadata/letterFolders.test.ts`. Copy the setup from `apps/raven/server/src/metadata/shows.test.ts` (lines 1 to 230): the imports, `state`, `app()`, `settle()`, `shows()`, `media()`, `shape`, and the `createApp` call with `metadataFetch: tmdb.fetch`. Use this fake TMDB and these files:

```ts
const tmdb = fakeTmdb({
  movies: [
    { id: 348, title: 'Alien', released: '1979-05-25' },
    { id: 949, title: 'Heat', released: '1995-12-15' },
  ],
  shows: [
    { id: 83867, title: 'Andor', first: '2022-09-21', seasons: { 1: [{ number: 1, title: 'Kassa', aired: '2022-09-21' }], 2: [{ number: 1, title: 'One Year Later', aired: '2025-04-22' }] } },
    { id: 114461, title: 'Ahsoka', first: '2023-08-22', seasons: { 1: [{ number: 1, title: 'Master and Apprentice', aired: '2023-08-22' }] } },
    { id: 46298, title: 'K', first: '2012-10-05', seasons: { 1: [{ number: 1, title: 'Kitten', aired: '2012-10-05' }] } },
    { id: 250307, title: 'Cupertino', first: '2026-01-10', seasons: { 1: [{ number: 1, title: 'Pilot', aired: '2026-01-10' }] } },
  ],
})
```

```ts
  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-letters-'))
    state.tv = join(state.root, 'TV')
    state.movies = join(state.root, 'Movies')
    state.data = join(state.root, 'data')
    await Promise.all([
      encodeClip({ path: join(state.tv, 'A', 'Andor', 'Season 1', 'Andor - S01E01 - Kassa.mp4'), seconds: 1 }),
      encodeClip({ path: join(state.tv, 'A', 'Ahsoka', 'Season 1', 'Ahsoka - S01E01 - Master and Apprentice.mp4'), seconds: 1 }),
      encodeClip({ path: join(state.tv, 'K', 'K', 'Season 1', 'K - S01E01 - Kitten.mp4'), seconds: 1 }),
      encodeClip({ path: join(state.tv, 'Requests', 'Cupertino', 'Season 1', 'Cupertino - S01E01 - Pilot.mp4'), seconds: 1 }),
      encodeClip({ path: join(state.movies, 'A', 'Alien (1979)', 'Alien (1979).mp4'), seconds: 1 }),
      encodeClip({ path: join(state.movies, 'H', 'Heat (1995).mp4'), seconds: 1 }),
    ])
    // createApp exactly as shows.test.ts does, then two libraries:
    state.shows = await createLibrary({ name: 'TV', path: state.tv, kind: 'shows' })
    state.moviesLibrary = await createLibrary({ name: 'Movies', path: state.movies, kind: 'movies' })
    await settle()
  })
```

`createLibrary` is a local helper that POSTs `/api/libraries` with `{ name, paths: [path], settings: { kind } }` and returns the created id through `shape({ ..., guard: isLibrary })`. `settle()` waits on both libraries' scans (`ScannerService.whenIdle(id)` for each), then `MetadataService.whenIdle()` and `ThumbnailService.whenIdle()`. Add `tv`, `movies`, `shows` and `moviesLibrary` to `state`.

The tests:

```ts
  it('matches each show under a letter or group folder as its own show', async () => {
    const listing = await showsOf(state.shows)
    expect(listing.shows.map((entry) => entry.show.title)).toEqual(['Ahsoka', 'Andor', 'Cupertino', 'K'])
    expect(listing.unmatched).toEqual([])
  })

  it('files each episode under its show, not its letter', async () => {
    const andor = (await mediaOf(state.shows)).find((item) => item.fileName === 'Andor - S01E01 - Kassa.mp4')
    expect(andor?.folder).toBe('Andor/Season 1')
  })

  it('says the TV path has letter folders, and how many group folders', async () => {
    const library = await libraryOf(state.shows)
    expect(library.layouts).toEqual([{ path: state.tv, layout: 'lettered', groups: 3 }])
  })

  it('reads movies under letter folders, a loose one included', async () => {
    const items = await mediaOf(state.moviesLibrary)
    expect(items.map((item) => [item.fileName, item.folder, item.match]).toSorted()).toEqual([
      ['Alien (1979).mp4', 'Alien (1979)', 'matched'],
      ['Heat (1995).mp4', '', 'matched'],
    ])
  })

  it('files a new episode the watcher finds inside a letter folder under its show', async () => {
    const path = join(state.tv, 'A', 'Andor', 'Season 2', 'Andor - S02E01 - One Year Later.mp4')
    await encodeClip({ path, seconds: 1 })
    app().get(ScannerService).refresh({ libraryId: state.shows, places: [path] })
    await settle()
    const added = (await mediaOf(state.shows)).find((item) => item.fileName === 'Andor - S02E01 - One Year Later.mp4')
    expect(added?.folder).toBe('Andor/Season 2')
    expect((await showsOf(state.shows)).shows.map((entry) => entry.show.title)).toEqual(['Ahsoka', 'Andor', 'Cupertino', 'K'])
  })

  it('fixes the match of one show under a letter folder without touching its neighbours', async () => {
    const before = await showsOf(state.shows)
    const andor = before.shows.find((entry) => entry.show.title === 'Andor')
    await app().inject({ method: 'PUT', url: `/api/items/${andor?.show.id}/match`, payload: { tmdbId: '114461' } })
    await settle()
    const states = (await mediaOf(state.shows)).map((item) => [item.fileName, item.match]).toSorted()
    expect(states).toEqual([
      ['Ahsoka - S01E01 - Master and Apprentice.mp4', 'matched'],
      ['Andor - S01E01 - Kassa.mp4', 'manual'],
      ['Andor - S02E01 - One Year Later.mp4', 'manual'],
      ['Cupertino - S01E01 - Pilot.mp4', 'matched'],
      ['K - S01E01 - Kitten.mp4', 'matched'],
    ])
  })
```

`showsOf`, `mediaOf` and `libraryOf` are the `shows()` and `media()` helpers from `shows.test.ts`, taking a library id, plus a `GET /api/libraries/:id` read through `isLibrary`. Only Andor's two files become `manual`. Under the old reading, the Fix match would have covered everything under `A/`, Ahsoka included. Run this test last in the file, since it changes what Andor is.

- [ ] **Step 6: Run it, and fix what fails**

Run: `bunx nx run @raven/server:test -- src/metadata/letterFolders.test.ts`
Expected: PASS. If the shows listing is `['A', 'K', 'Requests']`, `reindex` is not rooting files (Step 4).

Run: `bunx nx run @raven/server:test`
Expected: PASS. `shows.test.ts` and `movies.test.ts` use flat folders, so their expectations hold.

- [ ] **Step 7: Document it**

In `apps/raven/README.md`, in the section on how scanning works (around line 176, which describes the Sonarr layout `Show (Year)/Season 01/...`), add:

```markdown
Letter folders and group folders are read as holding the titles: in
`A/Andor/Season 1/` the show is Andor, and in `Requests/Cupertino/Season 1/`
it is Cupertino. A letter folder is one letter, `#`, `0-9` or a run such as
`A-C`. A show named with one letter keeps its name when its season folders
sit right under it (`K/Season 1/`). In a movie library, a folder with no year
that holds folders with years (`Requests/25th Hour (2002)/`) is a group
folder too. Edit library shows what each path was read as, and "Read letter
and group folders" turns this off for a library whose folder names really
are titles.
```

- [ ] **Step 8: Commit**

```bash
git add apps/raven/server/src/scanner apps/raven/server/src/metadata/letterFolders.test.ts libs/raven/core/src/contract.ts apps/raven/README.md
git commit -m "$(cat <<'EOF'
MAE: raven files each title under its letter or group folder when scanning

- `titleRootOf` and `withTitleRoots`: `media.folder` is measured from the folder holding the titles
- a full scan records each path as flat, lettered or grouped
- a watcher refresh inside a letter folder files the episode under its show
EOF
)"
```

---

### Task 4: Relayout for rows indexed the old way

**Files:**
- Modify: `apps/raven/server/src/scanner/layout.ts` (add `planRelayout`)
- Modify: `apps/raven/server/src/scanner/layout.test.ts`
- Modify: `apps/raven/server/src/metadata/matchFiles.ts` (add `layoutRows`, `overridePlaces`, `applyRelayout`)
- Modify: `apps/raven/server/src/metadata/metadataService.ts` (`onApplicationBootstrap`, `changeKind`; add `relayoutNow`, `changeLayout`)
- Modify: `apps/raven/server/src/libraries/librariesController.ts` (`update`)
- Create: `apps/raven/server/src/metadata/relayout.test.ts`
- Modify: `apps/raven/server/src/metadata/letterFolders.test.ts`

**Interfaces:**
- Consumes:
  - `titleRootOf` (Task 3), `isUnder` (`scanner/walk.ts`);
  - `filePlace` and `showPlace` (`metadata/places.ts`), `groupBy` (`@/groupBy`);
  - `matchTypeFor` and `LibraryKind` (`@raven/core`), `namedAs` (`@/media/namedAs`).
- Produces:
  - `type LayoutRow = { id: number; path: string; folder: string; fileName: string }`;
  - `type RelayoutPlan = { moves: Array<{ id: number; folder: string }>; overrides: Array<{ from: string; to: string | null }> }`;
  - `planRelayout({ rows, roots, kind, layout, overrides }: { rows: readonly LayoutRow[]; roots: readonly string[]; kind: LibraryKind; layout: FolderLayout; overrides: readonly string[] }): RelayoutPlan`;
  - `MatchFiles.layoutRows(libraryId: number): LayoutRow[]`;
  - `MatchFiles.overridePlaces(libraryId: number): string[]`;
  - `MatchFiles.applyRelayout({ libraryId, kind, plan }: { libraryId: number; kind: LibraryKind; plan: RelayoutPlan }): void`;
  - `MetadataService.changeLayout({ libraryId }: { libraryId: number }): void`.

- [ ] **Step 1: Write the failing plan tests**

Append to `apps/raven/server/src/scanner/layout.test.ts`:

```ts
import { planRelayout } from '@/scanner/layout'

const row = (id: number, path: string, folder: string) => ({
  id,
  path,
  folder,
  fileName: path.slice(path.lastIndexOf('/') + 1),
})

describe('planRelayout', () => {
  const lettered = [
    row(1, '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', 'A/Andor/Season 1'),
    row(2, '/m/TV/A/Ahsoka/Season 1/Ahsoka - S01E01.mkv', 'A/Ahsoka/Season 1'),
    row(3, '/m/Reality/Alone/Season 1/Alone - S01E01.mkv', 'Alone/Season 1'),
  ]

  it('moves files indexed under their letter, and leaves a flat path alone', () => {
    const plan = planRelayout({ rows: lettered, roots: ['/m/TV', '/m/Reality'], kind: 'shows', layout: 'auto', overrides: [] })
    expect(plan.moves).toEqual([
      { id: 1, folder: 'Andor/Season 1' },
      { id: 2, folder: 'Ahsoka/Season 1' },
    ])
  })

  it('drops a Fix match kept for a whole letter, and keeps one for a flat show', () => {
    const plan = planRelayout({ rows: lettered, roots: ['/m/TV', '/m/Reality'], kind: 'shows', layout: 'auto', overrides: ['A', 'Alone'] })
    expect(plan.overrides).toEqual([{ from: 'A', to: null }])
  })

  it('moves a Fix match kept for a movie folder under a letter', () => {
    const plan = planRelayout({
      rows: [row(4, '/m/Movies/A/Alien (1979)/Alien (1979).mkv', 'A/Alien (1979)')],
      roots: ['/m/Movies'],
      kind: 'movies',
      layout: 'auto',
      overrides: ['A/Alien (1979)', 'A/Alien (1979)/Alien (1979).mkv'],
    })
    expect(plan.moves).toEqual([{ id: 4, folder: 'Alien (1979)' }])
    expect(plan.overrides).toEqual([
      { from: 'A/Alien (1979)', to: 'Alien (1979)' },
      { from: 'A/Alien (1979)/Alien (1979).mkv', to: 'Alien (1979)/Alien (1979).mkv' },
    ])
  })

  it('moves nothing in a library that is never matched, though it has letter folders', () => {
    const plan = planRelayout({
      rows: [row(5, '/m/Home/A/Beach/clip.mp4', 'A/Beach')],
      roots: ['/m/Home'],
      kind: 'other',
      layout: 'auto',
      overrides: [],
    })
    expect(plan).toEqual({ moves: [], overrides: [] })
  })

  it('moves files back under their letter when the library is set to flat', () => {
    const plan = planRelayout({
      rows: [row(1, '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', 'Andor/Season 1')],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'flat',
      overrides: ['Andor'],
    })
    expect(plan.moves).toEqual([{ id: 1, folder: 'A/Andor/Season 1' }])
    expect(plan.overrides).toEqual([{ from: 'Andor', to: 'A' }])
  })
})
```

Move the new `import` up to join the file's other imports.

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/scanner/layout.test.ts`
Expected: FAIL, `planRelayout is not exported`.

- [ ] **Step 3: Write `planRelayout`**

Append to `apps/raven/server/src/scanner/layout.ts`, importing `matchTypeFor` from `@raven/core`, `groupBy` from `@/groupBy`, `filePlace` and `showPlace` from `@/metadata/places`, and `isUnder` from `@/scanner/walk`:

```ts
/** A file as the index has it, for reading its place again. */
export type LayoutRow = { id: number; path: string; folder: string; fileName: string }

/** What a relayout changes: files' folders, and the Fix match places that move or go. */
export type RelayoutPlan = {
  moves: Array<{ id: number; folder: string }>
  overrides: Array<{ from: string; to: string | null }>
}

/** The places a Fix match can be kept under for a file: a show's folder or a movie's, and its own. */
const fixPlacesOf = ({
  kind,
  file,
}: {
  kind: LibraryKind
  file: { folder: string; fileName: string }
}): string[] =>
  matchTypeFor(kind) === 'show'
    ? [showPlace(file), filePlace(file)]
    : [file.folder, filePlace(file)]

/**
 * Reads every file's place again for the library's type and folder layout.
 * Only files whose folder changes move. A Fix match moves with its files
 * when its old place now names one place; one that named several, such as a
 * whole letter folder kept as one show, is dropped, as it was made for files
 * that were never one title.
 */
export const planRelayout = ({
  rows,
  roots,
  kind,
  layout,
  overrides,
}: {
  rows: readonly LayoutRow[]
  roots: readonly string[]
  kind: LibraryKind
  layout: FolderLayout
  overrides: readonly string[]
}): RelayoutPlan => {
  const moved = rows.flatMap((file) => {
    const root = roots.find((candidate) => isUnder({ path: file.path, root: candidate }))
    if (root == null) return []
    const folder = relative(titleRootOf({ root, path: file.path, kind, layout }), dirname(file.path))
    return folder === file.folder ? [] : [{ file, folder }]
  })
  const pairs = moved.flatMap(({ file, folder }) => {
    const after = fixPlacesOf({ kind, file: { folder, fileName: file.fileName } })
    return fixPlacesOf({ kind, file })
      .map((from, index) => ({ from, to: after[index] ?? '' }))
      .filter((pair) => pair.from !== '')
  })
  const targets = groupBy({ items: pairs, key: (pair) => pair.from })
  return {
    moves: moved.map(({ file, folder }) => ({ id: file.id, folder })),
    overrides: overrides.flatMap((from) => {
      const to = [...new Set((targets.get(from) ?? []).map((pair) => pair.to))]
      if (to.length === 0) return []
      const [only] = to
      return [{ from, to: to.length === 1 && only != null && only !== '' ? only : null }]
    }),
  }
}
```

Run: `bunx nx run @raven/server:test -- src/scanner/layout.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing database test**

Create `apps/raven/server/src/metadata/relayout.test.ts`. It indexes files the old way, by inserting with `root` set to the library path. It links one movie and one show, saves Fix matches, applies a plan, and checks the rows:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { localSeason } from '@/metadata/localItems'
import { MatchFiles } from '@/metadata/matchFiles'
import type { FetchedItem } from '@/metadata/tmdbClient'
import { planRelayout } from '@/scanner/layout'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

/** The least TMDB item `MetadataRepository.save` takes, as `metadataRepository.test.ts` builds one. */
const fetched = ({ type, tmdbId }: { type: FetchedItem['type']; tmdbId: string }): FetchedItem => ({
  ...localSeason({ showTmdbId: '1', number: 1 }),
  type,
  tmdbId,
  number: null,
  title: tmdbId,
  credits: [],
})

describe('relayout', () => {
  const database = testDatabase('raven-relayout-')
  beforeAll(database.open)
  afterAll(database.close)

  const setUp = ({ kind, root, paths }: { kind: 'shows' | 'movies'; root: string; paths: string[] }) => {
    const libraries = new LibrariesRepository(database.get())
    const { metadata } = repositories(database.get())
    const files = new MatchFiles(database.get(), metadata)
    const index = new MediaIndex(database.get())
    const library = libraries.create({ name: kind, paths: [root], settings: { kind } })
    const ids = paths.map((path) =>
      index.insert({ libraryId: library.id, kind, file: { path, root, size: 1, mtimeMs: 1 } }),
    )
    return { library, files, metadata, ids }
  }

  it('sends regrouped show files back to matching, and drops a whole letter\'s Fix match', () => {
    const { library, files, metadata, ids } = setUp({
      kind: 'shows',
      root: '/m/TV',
      paths: ['/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', '/m/TV/A/Ahsoka/Season 1/Ahsoka - S01E01.mkv'],
    })
    const show = metadata.save({ item: fetched({ type: 'show', tmdbId: '1' }) })
    files.settle({ ids, itemIds: [show], match: 'matched' })
    files.saveFixMatch({ libraryId: library.id, place: 'A', fix: { kind: 'tmdb', tmdbId: '1' } })

    const plan = planRelayout({
      rows: files.layoutRows(library.id),
      roots: library.paths,
      kind: 'shows',
      layout: 'auto',
      overrides: files.overridePlaces(library.id),
    })
    files.applyRelayout({ libraryId: library.id, kind: 'shows', plan })

    expect(files.byIds(ids).map((file) => [file.folder, file.match])).toEqual([
      ['Andor/Season 1', 'pending'],
      ['Ahsoka/Season 1', 'pending'],
    ])
    expect(metadata.mediaUnder(show)).toEqual([])
    expect(files.fixMatchAt({ libraryId: library.id, place: 'A' })).toEqual({ kind: 'none' })
  })

  it('keeps a movie\'s match and moves its Fix match with its folder', () => {
    const { library, files, metadata, ids } = setUp({
      kind: 'movies',
      root: '/m/Movies',
      paths: ['/m/Movies/A/Alien (1979)/Alien (1979).mkv'],
    })
    const movie = metadata.save({ item: fetched({ type: 'movie', tmdbId: '348' }) })
    files.settle({ ids, itemIds: [movie], match: 'manual' })
    files.saveFixMatch({ libraryId: library.id, place: 'A/Alien (1979)', fix: { kind: 'tmdb', tmdbId: '348' } })

    const plan = planRelayout({
      rows: files.layoutRows(library.id),
      roots: library.paths,
      kind: 'movies',
      layout: 'auto',
      overrides: files.overridePlaces(library.id),
    })
    files.applyRelayout({ libraryId: library.id, kind: 'movies', plan })

    expect(files.byIds(ids).map((file) => [file.folder, file.match])).toEqual([['Alien (1979)', 'manual']])
    expect(metadata.mediaUnder(movie)).toEqual(ids)
    expect(files.fixMatchAt({ libraryId: library.id, place: 'Alien (1979)' })).toEqual({ kind: 'tmdb', tmdbId: '348' })
    expect(files.fixMatchAt({ libraryId: library.id, place: 'A/Alien (1979)' })).toEqual({ kind: 'none' })
  })
})
```

`metadata.save({ item })` returns the new item's id. `mediaUnder(itemId)` is the existing call `forgetItem` uses to list the files linked under an item.

- [ ] **Step 5: Run it to see it fail**

Run: `bunx nx run @raven/server:test -- src/metadata/relayout.test.ts`
Expected: FAIL, `files.layoutRows is not a function`.

- [ ] **Step 6: Add the three `MatchFiles` methods**

In `apps/raven/server/src/metadata/matchFiles.ts`, import `matchTypeFor` from `@raven/core` and `type RelayoutPlan, type LayoutRow` from `@/scanner/layout`. Add after `retryUnmatched`:

```ts
  /** Every file of a library with where it sits, for reading its place again. */
  layoutRows(libraryId: number): LayoutRow[] {
    return this.db
      .prepare<[number], { id: number; path: string; folder: string; file_name: string }>(
        'SELECT id, path, folder, file_name FROM media WHERE library_id = ?',
      )
      .all(libraryId)
      .map((row) => ({ id: row.id, path: row.path, folder: row.folder, fileName: row.file_name }))
  }

  /** The places a library keeps Fix matches under. */
  overridePlaces(libraryId: number): string[] {
    return this.db
      .prepare<[number], { place: string }>('SELECT place FROM match_overrides WHERE library_id = ?')
      .all(libraryId)
      .map((row) => row.place)
  }

  /**
   * Writes a relayout in one go. A TV library's moved files are regrouped,
   * so they lose their links and wait to be matched again; a movie keeps
   * its match unless its name now reads as another title. Fix matches move
   * with their place, or go.
   */
  applyRelayout({
    libraryId,
    kind,
    plan,
  }: {
    libraryId: number
    kind: LibraryKind
    plan: RelayoutPlan
  }): void {
    const setFolder = this.db.prepare('UPDATE media SET folder = ? WHERE id = ?')
    const moveFix = this.db.prepare(
      'UPDATE OR REPLACE match_overrides SET place = ? WHERE library_id = ? AND place = ?',
    )
    const dropFix = this.db.prepare('DELETE FROM match_overrides WHERE library_id = ? AND place = ?')
    this.db.transaction(() => {
      plan.moves.forEach((move) => setFolder.run(move.folder, move.id))
      const moved = this.byIds(plan.moves.map((move) => move.id))
      const regrouped =
        matchTypeFor(kind) === 'show'
          ? moved
          : moved.filter((file) => {
              const named = namedAs({ kind, fileName: file.fileName, folder: file.folder })
              return named.title !== file.title || named.year !== file.year
            })
      this.metadata.unlink(regrouped.map((file) => file.id))
      this.rewriteNames({ rows: regrouped, kind })
      plan.overrides.forEach(({ from, to }) => {
        if (to == null) {
          dropFix.run(libraryId, from)
          return
        }
        moveFix.run(to, libraryId, from)
      })
    })()
  }
```

Run: `bunx nx run @raven/server:test -- src/metadata/relayout.test.ts`
Expected: PASS.

- [ ] **Step 7: Run relayouts on boot, on a layout change and on a type change**

In `apps/raven/server/src/metadata/metadataService.ts`, import `planRelayout` from `@/scanner/layout` and add:

```ts
  /**
   * Reads where each of a library's files sits again, for its type and
   * folder layout, and moves those that changed. Whether any did.
   */
  private relayoutNow(libraryId: number): boolean {
    const library = this.libraries.get(libraryId)
    if (!library) return false
    const plan = planRelayout({
      rows: this.files.layoutRows(libraryId),
      roots: library.paths,
      kind: library.settings.kind,
      layout: library.settings.folderLayout,
      overrides: this.files.overridePlaces(libraryId),
    })
    if (plan.moves.length === 0) return false
    this.files.applyRelayout({ libraryId, kind: library.settings.kind, plan })
    this.logger.log(`Read ${plan.moves.length} files of "${library.name}" under their letter or group folders again`)
    return true
  }

  /** A library's folder layout changed: its files are read again and matched where they regrouped. */
  changeLayout({ libraryId }: { libraryId: number }): void {
    this.queue.push(`layout:${libraryId}`, async () => {
      this.relayoutNow(libraryId)
      await this.pass(libraryId)
    })
  }
```

In `onApplicationBootstrap`, call `this.relayoutNow(library.id)` first inside the `forEach`, before `const { kind } = library.settings`. It runs for every library: one that is never matched gets its rows put back at its library path if they were ever title-rooted.

In `changeKind`'s queued task, call `this.relayoutNow(libraryId)` before `this.files.rename(...)`.

In `apps/raven/server/src/libraries/librariesController.ts` `update`, replace the `changeKind` block with:

```ts
    if (matchTypeFor(before.settings.kind) !== matchTypeFor(record.settings.kind)) {
      this.metadata.changeKind({ libraryId: id, kind: record.settings.kind })
    } else if (before.settings.folderLayout !== record.settings.folderLayout) {
      this.metadata.changeLayout({ libraryId: id })
    }
```

Update the method's doc comment: "Only a change of folders rescans. A change of type that reads files another way, or of folder layout, reads them again and matches what regrouped. A rename or another setting, the lock included, leaves the index as it is."

- [ ] **Step 8: Write the failing end-to-end layout switch**

Add to `apps/raven/server/src/metadata/letterFolders.test.ts`, before the Fix match test so Andor is still Andor:

```ts
  it('reads every top folder as a title when set to flat, and letter folders again when set back', async () => {
    const setLayout = async (folderLayout: 'auto' | 'flat') => {
      await app().inject({
        method: 'PUT',
        url: `/api/libraries/${state.shows}`,
        payload: { name: 'TV', paths: [state.tv], settings: { kind: 'shows', folderLayout } },
      })
      await settle()
    }
    await setLayout('flat')
    const andor = (await mediaOf(state.shows)).find((item) => item.fileName === 'Andor - S01E01 - Kassa.mp4')
    expect(andor?.folder).toBe('A/Andor/Season 1')
    await setLayout('auto')
    expect((await showsOf(state.shows)).shows.map((entry) => entry.show.title)).toEqual(['Ahsoka', 'Andor', 'Cupertino', 'K'])
  })
```

Run: `bunx nx run @raven/server:test -- src/metadata/letterFolders.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the server suite**

Run: `bunx nx run @raven/server:test`
Expected: PASS. `shows.test.ts` around line 257 ("keeps every match as an Anime shows library") still passes: shows to Anime shows keeps the match type, so `update` runs neither `changeKind` nor `changeLayout`.

- [ ] **Step 10: Commit**

```bash
git add apps/raven/server/src/scanner apps/raven/server/src/metadata apps/raven/server/src/libraries/librariesController.ts
git commit -m "$(cat <<'EOF'
MAE: raven reads libraries indexed before letter folders again on boot

- `planRelayout` moves only files whose folder changes; Fix matches move with them or go
- TV files that regroup go back to matching; movies keep their match
- runs on every boot, on a folder layout change, and on a type change
EOF
)"
```

---

### Task 5: The Folder layout choice in Edit library

**Files:**
- Modify: `apps/raven/web/src/components/LibraryDialog/LibraryDialog.tsx`
- Modify: `apps/raven/web/src/components/LibraryDialog/LibraryDialog.module.scss`
- Test: `apps/raven/web/src/components/LibraryDialog/LibraryDialog.test.tsx`

**Interfaces:**
- Consumes: `LibrarySettings.folderLayout`, `Library.layouts`, `PathLayout` and `matchTypeFor` (`@raven/core`).
- Produces: UI only.

- [ ] **Step 1: Write the failing tests**

Append inside the dialog's `describe` in `LibraryDialog.test.tsx`, following the "Lock with the PIN" tests' style (`created`, `updated`, `library()` fixture, `renderWithProviders`):

```tsx
  it('reads letter and group folders unless told not to', async () => {
    renderWithProviders(
      <LibraryDialog
        library={library({ settings: { ...library().settings, kind: 'animeShows' } })}
        onClose={() => undefined}
      />,
    )
    const box = screen.getByRole('checkbox', { name: 'Read letter and group folders' })
    expect(box).toBeChecked()
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updated.at(-1)).toMatchObject({ settings: { folderLayout: 'flat' } })
  })

  it('says what each path was read as', () => {
    renderWithProviders(
      <LibraryDialog
        library={library({
          paths: ['/media/Anime', '/media/Classics'],
          layouts: [
            { path: '/media/Anime', layout: 'lettered', groups: 23 },
            { path: '/media/Classics', layout: 'flat', groups: 0 },
          ],
          settings: { ...library().settings, kind: 'animeShows' },
        })}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText('/media/Anime: letter folders (23)')).toBeTruthy()
    expect(screen.getByText('/media/Classics: one folder per title')).toBeTruthy()
  })

  it('offers no folder layout for a library that is never matched', () => {
    renderWithProviders(<LibraryDialog onClose={() => undefined} />)
    expect(screen.queryByRole('checkbox', { name: 'Read letter and group folders' })).toBeNull()
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/components/LibraryDialog/LibraryDialog.test.tsx`
Expected: FAIL, no checkbox named "Read letter and group folders".

- [ ] **Step 3: Add the choice**

In `LibraryDialog.tsx`, import `type PathLayout` from `@raven/core`. Below `RATINGS_LABELS`, add:

```tsx
/** What Edit library calls each way a path was read. */
const pathLayoutLabel = ({ layout, groups }: { layout: PathLayout | null; groups: number }): string => {
  if (layout == null) return 'not scanned yet'
  if (layout === 'flat') return 'one folder per title'
  return layout === 'lettered' ? `letter folders (${groups})` : `group folders (${groups})`
}
```

Inside the settings `fieldset`, directly before the `{matchTypeFor(settings.kind) != null && (` block for Ratings shown, add:

```tsx
          {matchTypeFor(settings.kind) != null && (
            <div className={styles.setting}>
              <input
                id={`${ids.settings}-layout`}
                type="checkbox"
                className={styles.checkbox}
                checked={settings.folderLayout === 'auto'}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    folderLayout: event.target.checked ? 'auto' : 'flat',
                  }))
                }
                aria-describedby={`${ids.settings}-layout-hint`}
              />
              <label htmlFor={`${ids.settings}-layout`}>Read letter and group folders</label>
              <div id={`${ids.settings}-layout-hint`} className={styles.settingHint}>
                <p>
                  Shows and movies inside letter folders (A, B, #) and group folders such as
                  Requests are read as titles of their own. Turn this off when those folder names
                  are the titles.
                </p>
                {!!library && library.layouts.length > 0 && (
                  <ul className={styles.layouts}>
                    {library.layouts.map((entry) => (
                      <li key={entry.path}>{`${entry.path}: ${pathLayoutLabel(entry)}`}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
```

In `LibraryDialog.module.scss`, after `.settingHint`:

```scss
.settingHint > p {
  margin: 0;
}

.layouts {
  display: grid;
  gap: var(--space-0);
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-wrap: anywhere;
}
```

If `.settingHint` is not already a grid, give it `display: grid; gap: var(--space-0);`, so the paragraph and the list sit apart through `gap`, never margins.

- [ ] **Step 4: Run the tests to see them pass**

Run: `bunx nx run @raven/web:test -- src/components/LibraryDialog/LibraryDialog.test.tsx`
Expected: PASS.

Run: `bunx nx run @raven/web:test`
Expected: PASS.

- [ ] **Step 5: Check it in the browser**

Start the server and web app as `apps/raven/README.md` describes for development, with a library pointed at a folder that has `A/Show/Season 1/` and `Requests/Show/Season 1/`. Open Edit library. The checkbox is checked, and the path reads "letter folders (2)". At 320px wide the long path wraps and the dialog does not scroll sideways.

- [ ] **Step 6: Commit**

```bash
git add apps/raven/web/src/components/LibraryDialog
git commit -m "$(cat <<'EOF'
MAE: raven's Edit library shows how each path's folders were read

- "Read letter and group folders", on by default for matched libraries
- each path reads as letter folders, group folders or one folder per title
EOF
)"
```

---

### Task 6: Verify the branch

- [ ] **Step 1: Run every check**

Run: `bun run verify`
Expected: PASS: lint, format, typecheck, the `typescript-only` and `one-command-per-script` targets, and every test.

- [ ] **Step 2: Check the upgrade against Vhagar's data, read-only**

Take a fresh read-only snapshot of Vhagar's database, as the spike did (`sqlite3 -readonly ... ".backup"` into the session scratchpad, then `PRAGMA journal_mode=DELETE` on the copy). Point a local dev server's `DATA_DIR` at a copy of it, with `SCAN_ON_START=0` and no TMDB token. Start it once and read the log line from `relayoutNow` for each library.

Expected:
- Anime Shows and TV Shows report moved files.
- 4K Movies and Movies report moved files, but keep their matches.
- 4K TV Shows, UFC and every Other library report none.
- Afterwards, `SELECT folder FROM media WHERE path LIKE '%/Anime Shows/A/Akudama Drive/%' LIMIT 1` reads `Akudama Drive/Season 1`.

- [ ] **Step 3: Note it for the PR**

Add to the PR's testing notes: on deploy, Vhagar's Anime Shows and Vermithor TV paths go back to matching once (about 28,000 files and roughly 1,000 TMDB calls at 20 a second), and their show cards fill in as the pass runs.
