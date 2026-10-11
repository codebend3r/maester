import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_LIBRARY_SETTINGS,
  type LibraryInput,
  type LibrarySettings,
  isLibraryKind,
  isLibraryView,
  isMediaGroupBy,
  isMediaSort,
  isWatchedPercent,
} from '@raven/core'
import { DatabaseService } from '@/db/database'

/** A library as stored, before the scanner's live status is merged in. */
export type LibraryRecord = {
  id: number
  name: string
  paths: string[]
  itemCount: number
  createdAt: string
  settings: LibrarySettings
}

type LibraryRow = {
  id: number
  name: string
  created_at: string
  item_count: number
  save_progress: number
  pinned: number
  sort: string
  view_mode: string
  group_by: string
  watched_percent: number
  kind: string
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
})

/** The settings columns in the order the statements below bind them. */
const settingValues = (
  settings: LibrarySettings,
): [number, number, string, string, string, number, string] => [
  Number(settings.saveProgress),
  Number(settings.pinned),
  settings.sort,
  settings.view,
  settings.groupBy,
  settings.watchedPercent,
  settings.kind,
]

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
        `SELECT l.id, l.name, l.created_at, l.save_progress, l.pinned, l.sort, l.view_mode, l.group_by,
                l.watched_percent, l.kind,
                (SELECT COUNT(*) FROM media m WHERE m.library_id = l.id) AS item_count
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
    const settings = { ...DEFAULT_LIBRARY_SETTINGS, ...input.settings }
    const id = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO libraries (name, created_at, save_progress, pinned, sort, view_mode, group_by,
                                  watched_percent, kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.name, new Date().toISOString(), ...settingValues(settings))
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
    const settings = { ...current.settings, ...input.settings }
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE libraries
              SET name = ?, save_progress = ?, pinned = ?, sort = ?, view_mode = ?, group_by = ?,
                  watched_percent = ?, kind = ?
            WHERE id = ?`,
        )
        .run(input.name, ...settingValues(settings), id)
      this.replacePaths({ id, paths: input.paths })
    })()
    return this.get(id)
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM libraries WHERE id = ?').run(id).changes > 0
  }
}
