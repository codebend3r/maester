import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_LIBRARY_SETTINGS,
  defaultLibrarySettings,
  type LibraryInput,
  type LibrarySettings,
  isLibraryKind,
  isLibraryView,
  isMediaGroupBy,
  isMediaSort,
  isShownRatings,
  isWatchedPercent,
  withLibraryKind,
} from '@raven/core'
import { DatabaseService } from '@/db/database'

/** A library as stored, before the scanner's live status is merged in. */
export type LibraryRecord = {
  id: number
  name: string
  paths: string[]
  itemCount: number
  unmatchedCount: number
  createdAt: string
  settings: LibrarySettings
}

type LibraryRow = {
  id: number
  name: string
  created_at: string
  item_count: number
  unmatched_count: number
  save_progress: number
  pinned: number
  sort: string
  view_mode: string
  group_by: string
  watched_percent: number
  kind: string
  ratings_source: string
  auto_refresh: number
  locked: number
}

/** A row's settings; a value the database holds but this version does not know falls back to the default. */
const toSettings = (row: LibraryRow): LibrarySettings => ({
  saveProgress: row.save_progress === 1,
  pinned: row.pinned === 1,
  sort: isMediaSort(row.sort) ? row.sort : DEFAULT_LIBRARY_SETTINGS.sort,
  view: isLibraryView(row.view_mode) ? row.view_mode : DEFAULT_LIBRARY_SETTINGS.view,
  groupBy: isMediaGroupBy(row.group_by) ? row.group_by : DEFAULT_LIBRARY_SETTINGS.groupBy,
  watchedPercent: isWatchedPercent(row.watched_percent)
    ? row.watched_percent
    : DEFAULT_LIBRARY_SETTINGS.watchedPercent,
  kind: isLibraryKind(row.kind) ? row.kind : DEFAULT_LIBRARY_SETTINGS.kind,
  ratingsSource: isShownRatings(row.ratings_source)
    ? row.ratings_source
    : DEFAULT_LIBRARY_SETTINGS.ratingsSource,
  autoRefresh: row.auto_refresh === 1,
  locked: row.locked === 1,
})

/**
 * The settings as the columns that hold them, bound by name. The statements
 * below are built from its keys, so a new setting is added here, in
 * `LibraryRow` and in `toSettings`, and in no statement.
 */
const settingParams = (settings: LibrarySettings) => ({
  save_progress: Number(settings.saveProgress),
  pinned: Number(settings.pinned),
  sort: settings.sort,
  view_mode: settings.view,
  group_by: settings.groupBy,
  watched_percent: settings.watchedPercent,
  kind: settings.kind,
  ratings_source: settings.ratingsSource,
  auto_refresh: Number(settings.autoRefresh),
  locked: Number(settings.locked),
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
}

@Injectable()
export class LibrariesRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** Every library, or just one when `id` is given. */
  private rows(id: number | null): LibraryRecord[] {
    const libraries = this.db
      .prepare<[number | null, number | null], LibraryRow>(
        `SELECT l.id, l.name, l.created_at, ${SETTING_COLUMNS.map((column) => `l.${column}`).join(', ')},
                (SELECT COUNT(*) FROM media m WHERE m.library_id = l.id) AS item_count,
                (SELECT COUNT(*) FROM media m WHERE m.library_id = l.id AND m.match = 'unmatched')
                  AS unmatched_count
           FROM libraries l
          WHERE ? IS NULL OR l.id = ?
          ORDER BY l.name COLLATE NOCASE`,
      )
      .all(id, id)
    const paths = this.db
      .prepare<[number | null, number | null], PathRow>(
        `SELECT library_id, path FROM library_paths
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
    }))
  }

  list(): LibraryRecord[] {
    return this.rows(null)
  }

  get(id: number): LibraryRecord | null {
    return this.rows(id)[0] ?? null
  }

  private replacePaths({ id, paths }: { id: number; paths: string[] }): void {
    this.db.prepare('DELETE FROM library_paths WHERE library_id = ?').run(id)
    const insert = this.db.prepare(
      'INSERT INTO library_paths (library_id, path, position) VALUES (?, ?, ?)',
    )
    paths.forEach((path, position) => insert.run(id, path, position))
  }

  create(input: LibraryInput): LibraryRecord {
    const settings = {
      ...defaultLibrarySettings(input.settings?.kind ?? DEFAULT_LIBRARY_SETTINGS.kind),
      ...input.settings,
    }
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
   * the ones it has. Media found only under a dropped path stays until the
   * rescan that follows removes it.
   */
  update({ id, input }: { id: number; input: LibraryInput }): LibraryRecord | null {
    const current = this.get(id)
    if (!current) return null
    const laid = { ...current.settings, ...input.settings }
    // A new type keeps the view and grouping it can show, and swaps the others for its own.
    const settings =
      laid.kind === current.settings.kind
        ? laid
        : withLibraryKind({ settings: laid, kind: laid.kind })
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
