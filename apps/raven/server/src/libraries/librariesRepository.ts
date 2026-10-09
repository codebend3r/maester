import { Inject, Injectable } from '@nestjs/common'
import type { LibraryInput } from '@raven/core'
import { DatabaseService } from '@/db/database'

/** A library as stored, before the scanner's live status is merged in. */
export type LibraryRecord = {
  id: number
  name: string
  paths: string[]
  itemCount: number
  createdAt: string
}

type LibraryRow = {
  id: number
  name: string
  created_at: string
  item_count: number
}

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
        `SELECT l.id, l.name, l.created_at,
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
    const id = this.db.transaction(() => {
      const result = this.db
        .prepare('INSERT INTO libraries (name, created_at) VALUES (?, ?)')
        .run(input.name, new Date().toISOString())
      const created = Number(result.lastInsertRowid)
      this.replacePaths({ id: created, paths: input.paths })
      return created
    })()
    const created = this.get(id)
    if (!created) throw new Error(`Library ${id} was not readable straight after it was created`)
    return created
  }

  /**
   * Renames the library and replaces its paths. Media found only under a
   * dropped path stays until the rescan that follows removes it.
   */
  update({ id, input }: { id: number; input: LibraryInput }): LibraryRecord | null {
    const changed = this.db.transaction(() => {
      const result = this.db
        .prepare('UPDATE libraries SET name = ? WHERE id = ?')
        .run(input.name, id)
      if (result.changes === 0) return false
      this.replacePaths({ id, paths: input.paths })
      return true
    })()
    return changed ? this.get(id) : null
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM libraries WHERE id = ?').run(id).changes > 0
  }
}
