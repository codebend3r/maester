import { basename, dirname, relative } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import { type LibraryKind, containerOf } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { namedAs } from '@/media/mediaRepository'
import type { Reconciled } from '@/scanner/reconcile'

/** What the scanner compares against the disk to find new, changed, moved and gone files. */
export type IndexedFile = {
  id: number
  size: number
  mtimeMs: number
  probed: boolean
}

export type FoundFile = {
  path: string
  /** The library path the walk found it under. */
  root: string
  size: number
  mtimeMs: number
}

/** A file waiting on ffprobe. */
export type ProbeTarget = { id: number; path: string }

/** Its name, and the folder it sits in under the library path that found it. */
const placeOf = (file: FoundFile): { fileName: string; folder: string } => ({
  fileName: basename(file.path),
  folder: relative(file.root, dirname(file.path)),
})

/**
 * The scanner's side of the media table: the index it diffs the disk
 * against, and the changes it writes back.
 */
@Injectable()
export class MediaIndex {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** Every indexed file in a library, keyed by absolute path. */
  forLibrary(libraryId: number): Map<string, IndexedFile> {
    const rows = this.db
      .prepare<
        [number],
        { id: number; path: string; size: number; mtime_ms: number; probed: number }
      >('SELECT id, path, size, mtime_ms, probed FROM media WHERE library_id = ?')
      .all(libraryId)
    return new Map(
      rows.map((row) => [
        row.path,
        { id: row.id, size: row.size, mtimeMs: row.mtime_ms, probed: row.probed === 1 },
      ]),
    )
  }

  /** A file new to the library; it changed when it came. */
  insert({
    libraryId,
    kind,
    file,
    at = new Date(),
  }: {
    libraryId: number
    kind: LibraryKind
    file: FoundFile
    at?: Date
  }): number {
    const { fileName, folder } = placeOf(file)
    const named = namedAs({ kind, fileName, folder })
    const result = this.db
      .prepare(
        `INSERT INTO media (library_id, path, file_name, folder, title, year, edition, match, container,
                            size, mtime_ms, added_at, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        libraryId,
        file.path,
        fileName,
        folder,
        named.title,
        named.year,
        named.edition,
        named.match,
        containerOf(fileName),
        file.size,
        Math.round(file.mtimeMs),
        at.toISOString(),
        at.toISOString(),
      )
    return Number(result.lastInsertRowid)
  }

  /** The file was replaced on disk: forget what the old one held so it gets probed again. */
  markChanged({
    id,
    size,
    mtimeMs,
    at = new Date(),
  }: {
    id: number
    size: number
    mtimeMs: number
    at?: Date
  }): void {
    this.db
      .prepare(
        `UPDATE media SET size = ?, mtime_ms = ?, probed = 0, probe_error = NULL, thumbnail = 'pending',
                tracks = NULL, changed_at = ?
          WHERE id = ?`,
      )
      .run(size, Math.round(mtimeMs), at.toISOString(), id)
  }

  /**
   * A file renamed or moved on disk is the same video: it keeps its id, so
   * its match, progress, favourite, plays and thumbnail stay. Its name is
   * read again, and one no match was found for gets another try.
   */
  move({
    id,
    kind,
    file,
    at = new Date(),
  }: {
    id: number
    kind: LibraryKind
    file: FoundFile
    at?: Date
  }): void {
    const { fileName, folder } = placeOf(file)
    const named = namedAs({ kind, fileName, folder })
    this.db
      .prepare(
        `UPDATE media SET path = ?, file_name = ?, folder = ?, title = ?, year = ?, edition = ?,
                container = ?, changed_at = ?,
                match = CASE WHEN match = 'unmatched' THEN ? ELSE match END
          WHERE id = ?`,
      )
      .run(
        file.path,
        fileName,
        folder,
        named.title,
        named.year,
        named.edition,
        containerOf(fileName),
        at.toISOString(),
        named.match,
        id,
      )
  }

  /**
   * Writes what a scan found in one transaction, so nothing reads the
   * library half updated, and hands back the files to probe: the new ones,
   * the replaced ones, and any never probed.
   */
  apply({
    libraryId,
    kind,
    changes,
  }: {
    libraryId: number
    kind: LibraryKind
    changes: Reconciled
  }): ProbeTarget[] {
    const at = new Date()
    const remove = this.db.prepare('DELETE FROM media WHERE id = ?')
    return this.db.transaction(() => {
      changes.gone.forEach((id) => remove.run(id))
      changes.moved.forEach(({ id, file }) => this.move({ id, kind, file, at }))
      changes.changed.forEach(({ id, file }) =>
        this.markChanged({ id, size: file.size, mtimeMs: file.mtimeMs, at }),
      )
      const added = changes.added.map((file) => ({
        id: this.insert({ libraryId, kind, file, at }),
        path: file.path,
      }))
      return [
        ...added,
        ...changes.changed.map(({ id, file }) => ({ id, path: file.path })),
        ...changes.unprobed,
      ]
    })()
  }
}
