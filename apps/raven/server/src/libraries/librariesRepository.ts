import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_LIBRARY_SETTINGS,
  type LibraryInput,
  type LibraryPathLayout,
  type LibrarySettings,
  type PathLayout,
  coherentSettings,
  defaultLibrarySettings,
  isLibrarySettings,
  isPathLayout,
  keyOf,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { LOCAL } from '@/metadata/localItems'

/** A library as stored, before the scanner's live status is merged in. */
export type LibraryRecord = {
  id: number
  name: string
  paths: string[]
  layouts: LibraryPathLayout[]
  itemCount: number
  unmatchedCount: number
  createdAt: string
  settings: LibrarySettings
}

/** When a library's last full scan and last quick scan finished; null before each has run. */
export type ScanTimes = { fullScannedAt: string | null; quickScannedAt: string | null }

/**
 * A library's Refresh as stored: when the one under way began, null when
 * none is; how many titles it asked for; and when the last one finished.
 */
export type RatingsRefreshRecord = {
  startedAt: string | null
  total: number
  finishedAt: string | null
}

type LibraryRow = {
  id: number
  name: string
  created_at: string
  item_count: number
  unmatched_count: number
  save_progress: number
  pinned: number
  in_hero: number
  sort: string
  view_mode: string
  group_by: string
  watched_percent: number
  kind: string
  ratings_source: string
  auto_refresh: number
  locked: number
  folder_layout: string
  icon: string | null
}

const isSettingName = keyOf(isLibrarySettings.shape)

/**
 * Asks for fresh scores for each movie and show a library holds, reached up
 * from its files through their episodes and seasons, but those raven made up.
 */
const REQUEST_SCORES = `WITH RECURSIVE up(id) AS (
    SELECT mi.item_id FROM media m JOIN media_items mi ON mi.media_id = m.id
     WHERE m.library_id = @id
    UNION SELECT i.parent_id FROM items i JOIN up ON i.id = up.id
     WHERE i.parent_id IS NOT NULL)
  INSERT OR IGNORE INTO score_requests (library_id, item_id)
  SELECT @id, i.id FROM up JOIN items i ON i.id = up.id
   WHERE i.type IN ('movie', 'show') AND i.tmdb_id NOT GLOB @local`

/** A 4K frame, as `resolutionLabel` in `@raven/core` reads one: scope encodes shave height, so width counts too. */
const IS_4K = '(m.width >= 3200 OR m.height >= 1800)'

/**
 * A row's settings. Each column is read as its setting, and checked with
 * that setting's guard from the contract: a value this version does not
 * know is the default's, and a sort, view or grouping the library's type
 * cannot show is its type's.
 */
const toSettings = (row: LibraryRow): LibrarySettings => {
  const stored = {
    saveProgress: row.save_progress === 1,
    pinned: row.pinned === 1,
    inHero: row.in_hero === 1,
    sort: row.sort,
    view: row.view_mode,
    groupBy: row.group_by,
    watchedPercent: row.watched_percent,
    kind: row.kind,
    ratingsSource: row.ratings_source,
    autoRefresh: row.auto_refresh === 1,
    locked: row.locked === 1,
    folderLayout: row.folder_layout,
    icon: row.icon,
  } satisfies Record<keyof LibrarySettings, unknown>
  const known = Object.fromEntries(
    Object.entries(stored).filter(
      ([name, value]) => isSettingName(name) && isLibrarySettings.shape[name](value),
    ),
  )
  const settings = { ...DEFAULT_LIBRARY_SETTINGS, ...known }
  return coherentSettings(isLibrarySettings(settings) ? settings : DEFAULT_LIBRARY_SETTINGS)
}

/**
 * The settings as the columns that hold them, bound by name. The statements
 * below are built from its keys, so a new setting is added here, in
 * `LibraryRow` and in `toSettings`, and in no statement.
 */
const settingParams = (settings: LibrarySettings) => ({
  save_progress: Number(settings.saveProgress),
  pinned: Number(settings.pinned),
  in_hero: Number(settings.inHero),
  sort: settings.sort,
  view_mode: settings.view,
  group_by: settings.groupBy,
  watched_percent: settings.watchedPercent,
  kind: settings.kind,
  ratings_source: settings.ratingsSource,
  auto_refresh: Number(settings.autoRefresh),
  locked: Number(settings.locked),
  folder_layout: settings.folderLayout,
  icon: settings.icon,
})

const SETTING_COLUMNS = Object.keys(settingParams(DEFAULT_LIBRARY_SETTINGS))

const INSERT_LIBRARY = `INSERT INTO libraries (name, created_at, ${SETTING_COLUMNS.join(', ')})
  VALUES (@name, @created_at, ${SETTING_COLUMNS.map((column) => `@${column}`).join(', ')})`

const UPDATE_LIBRARY = `UPDATE libraries
    SET name = @name, ${SETTING_COLUMNS.map((column) => `${column} = @${column}`).join(', ')}
  WHERE id = @id`

/** Whether a library's paths are the same, in the same order, as they were. */
export const samePaths = ({
  before,
  after,
}: {
  before: readonly string[]
  after: readonly string[]
}): boolean =>
  before.length === after.length && before.every((path, index) => path === after[index])

type PathRow = {
  library_id: number
  path: string
  layout: string | null
  group_folders: number
}

@Injectable()
export class LibrariesRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /**
   * Every library, or just one when `id` is given. The 4K libraries come
   * first, those whose probed videos are mostly 4K, then the rest, each by
   * name, so the side menu, the Libraries page and Home all lead with them.
   * Each count reads an index, never the files themselves; a probe fills
   * in the width, so `m.width IS NOT NULL` picks the probed files and lets
   * the 4K test read `media_library_probed`. The order names the 4K test's
   * column rather than an expression over the counts, which SQLite would
   * count again to sort by.
   */
  private rows(id: number | null): LibraryRecord[] {
    const libraries = this.db
      .prepare<[number | null, number | null], LibraryRow>(
        `SELECT l.id, l.name, l.created_at, ${SETTING_COLUMNS.map((column) => `l.${column}`).join(', ')},
                (SELECT COUNT(*) FROM media m WHERE m.library_id = l.id) AS item_count,
                (SELECT COUNT(*) FROM media m WHERE m.library_id = l.id AND m.match = 'unmatched')
                  AS unmatched_count,
                (SELECT 2 * COUNT(*) FILTER (WHERE ${IS_4K}) > COUNT(*)
                   FROM media m WHERE m.library_id = l.id AND m.width IS NOT NULL) AS is_4k
           FROM libraries l
          WHERE ? IS NULL OR l.id = ?
          ORDER BY is_4k DESC, l.name COLLATE NOCASE`,
      )
      .all(id, id)
    const paths = this.db
      .prepare<[number | null, number | null], PathRow>(
        `SELECT library_id, path, layout, group_folders FROM library_paths
          WHERE ? IS NULL OR library_id = ?
          ORDER BY position`,
      )
      .all(id, id)
    return libraries.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      itemCount: row.item_count,
      unmatchedCount: row.unmatched_count,
      settings: toSettings(row),
      paths: paths.filter((path) => path.library_id === row.id).map((path) => path.path),
      layouts: paths
        .filter((path) => path.library_id === row.id)
        .map((path) => ({
          path: path.path,
          layout: isPathLayout(path.layout) ? path.layout : null,
          groups: path.group_folders,
        })),
    }))
  }

  list(): LibraryRecord[] {
    return this.rows(null)
  }

  /** Every library's id, for a caller that has no use for the rest of its record. */
  ids(): number[] {
    return this.db
      .prepare<[], { id: number }>('SELECT id FROM libraries')
      .all()
      .map((row) => row.id)
  }

  get(id: number): LibraryRecord | null {
    return this.rows(id)[0] ?? null
  }

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

  /** What the library remembers of its scans across restarts; none for a library that is not there. */
  scanTimes(id: number): ScanTimes {
    const row = this.db
      .prepare<[number], { full_scanned_at: string | null; quick_scanned_at: string | null }>(
        'SELECT full_scanned_at, quick_scanned_at FROM libraries WHERE id = ?',
      )
      .get(id)
    return {
      fullScannedAt: row?.full_scanned_at ?? null,
      quickScannedAt: row?.quick_scanned_at ?? null,
    }
  }

  /** When a full scan of the library finished, kept so a restart does not forget it. */
  markFullScan({ id, at }: { id: number; at: string }): void {
    this.db.prepare('UPDATE libraries SET full_scanned_at = ? WHERE id = ?').run(at, id)
  }

  /** When a quick scan of the library finished, kept so a restart does not forget it. */
  markQuickScan({ id, at }: { id: number; at: string }): void {
    this.db.prepare('UPDATE libraries SET quick_scanned_at = ? WHERE id = ?').run(at, id)
  }

  /**
   * Begins a Refresh at `at`, asking for fresh scores for each of the
   * library's movies and shows when `shouldAsk`, in one transaction so no
   * request is ever left without its start. One that asks for nothing
   * finishes at once. Answers how many titles it asked for.
   */
  startRatingsRefresh({
    id,
    at,
    shouldAsk,
  }: {
    id: number
    at: string
    shouldAsk: boolean
  }): number {
    return this.db.transaction(() => {
      const total = shouldAsk
        ? this.db.prepare(REQUEST_SCORES).run({ id, local: `${LOCAL}*` }).changes
        : 0
      this.db
        .prepare(
          'UPDATE libraries SET ratings_refresh_started_at = ?, ratings_refresh_total = ? WHERE id = ?',
        )
        .run(at, total, id)
      if (total === 0) this.finishRatingsRefreshes(at)
      return total
    })()
  }

  /** The library's Refresh as it was left, across restarts; none for a library that is not there. */
  ratingsRefresh(id: number): RatingsRefreshRecord {
    const row = this.db
      .prepare<
        [number],
        {
          ratings_refresh_started_at: string | null
          ratings_refresh_total: number
          ratings_refreshed_at: string | null
        }
      >(
        `SELECT ratings_refresh_started_at, ratings_refresh_total, ratings_refreshed_at
           FROM libraries WHERE id = ?`,
      )
      .get(id)
    return {
      startedAt: row?.ratings_refresh_started_at ?? null,
      total: row?.ratings_refresh_total ?? 0,
      finishedAt: row?.ratings_refreshed_at ?? null,
    }
  }

  /** Finishes, at `at`, each Refresh under way with no title left waiting. */
  finishRatingsRefreshes(at: string): void {
    this.db
      .prepare(
        `UPDATE libraries SET ratings_refreshed_at = ?, ratings_refresh_started_at = NULL
          WHERE ratings_refresh_started_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM score_requests r WHERE r.library_id = libraries.id)`,
      )
      .run(at)
  }

  /** Each path a library keeps holds on to what a scan found it to be; a new one starts unread. */
  private replacePaths({ id, paths }: { id: number; paths: string[] }): void {
    const found = new Map(
      this.db
        .prepare<[number], Pick<PathRow, 'path' | 'layout' | 'group_folders'>>(
          'SELECT path, layout, group_folders FROM library_paths WHERE library_id = ?',
        )
        .all(id)
        .map((row) => [row.path, row]),
    )
    this.db.prepare('DELETE FROM library_paths WHERE library_id = ?').run(id)
    const insert = this.db.prepare(
      `INSERT INTO library_paths (library_id, path, position, layout, group_folders)
       VALUES (?, ?, ?, ?, ?)`,
    )
    paths.forEach((path, position) =>
      insert.run(
        id,
        path,
        position,
        found.get(path)?.layout ?? null,
        found.get(path)?.group_folders ?? 0,
      ),
    )
  }

  /** A new library starts with its type's defaults, under whatever settings were sent. */
  create(input: LibraryInput): LibraryRecord {
    const settings = coherentSettings({
      ...defaultLibrarySettings(input.settings?.kind ?? DEFAULT_LIBRARY_SETTINGS.kind),
      ...input.settings,
    })
    const id = this.db.transaction(() => {
      const result = this.db.prepare(INSERT_LIBRARY).run({
        name: input.name,
        created_at: new Date().toISOString(),
        ...settingParams(settings),
      })
      const created = Number(result.lastInsertRowid)
      this.replacePaths({ id: created, paths: input.paths })
      return created
    })()
    const created = this.get(id)
    if (!created) throw new Error(`Library ${id} was not readable straight after it was created`)
    return created
  }

  /**
   * Renames the library, replaces its paths, and lays the settings sent over
   * the ones it has. Whatever the type cannot show is swapped for its own,
   * so a new type keeps the view and grouping it can show. Media found only
   * under a dropped path stays until the rescan that follows removes it.
   */
  update({ id, input }: { id: number; input: LibraryInput }): LibraryRecord | null {
    const current = this.get(id)
    if (!current) return null
    const settings = coherentSettings({ ...current.settings, ...input.settings })
    this.db.transaction(() => {
      this.db.prepare(UPDATE_LIBRARY).run({ id, name: input.name, ...settingParams(settings) })
      this.replacePaths({ id, paths: input.paths })
    })()
    return this.get(id)
  }

  /** The libraries kept behind the PIN. */
  lockedIds(): Set<number> {
    return new Set(
      this.db
        .prepare<[], { id: number }>('SELECT id FROM libraries WHERE locked = 1')
        .all()
        .map((row) => row.id),
    )
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM libraries WHERE id = ?').run(id).changes > 0
  }
}
