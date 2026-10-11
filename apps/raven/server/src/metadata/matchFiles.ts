import { Inject, Injectable } from '@nestjs/common'
import { type LibraryKind, type MatchState, isMatchState } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { BEST_FIRST, escapeLike } from '@/media/mediaSql'
import { namedAs } from '@/media/namedAs'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** A file as matching sees it: its name, where it sits, and how matching went so far. */
export type MatchFile = {
  id: number
  libraryId: number
  path: string
  fileName: string
  folder: string
  title: string
  year: number | null
  match: MatchState
}

type FileRow = {
  id: number
  library_id: number
  path: string
  file_name: string
  folder: string
  title: string
  year: number | null
  match: string
}

const SELECT_FILES =
  'SELECT m.id, m.library_id, m.path, m.file_name, m.folder, m.title, m.year, m.match FROM media m'

const toMatchFile = (row: FileRow): MatchFile => ({
  id: row.id,
  libraryId: row.library_id,
  path: row.path,
  fileName: row.file_name,
  folder: row.folder,
  title: row.title,
  year: row.year,
  match: isMatchState(row.match) ? row.match : 'pending',
})

/**
 * The match queue: which files wait to be matched, the files that share a
 * place with one, and how matching went. Only metadata matching uses it.
 */
@Injectable()
export class MatchFiles {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  private files({
    where,
    params,
    order = 'm.folder, m.file_name',
  }: {
    where: string
    params: ReadonlyArray<string | number>
    order?: string
  }): MatchFile[] {
    return this.db
      .prepare<Array<string | number>, FileRow>(`${SELECT_FILES} WHERE ${where} ORDER BY ${order}`)
      .all(...params)
      .map(toMatchFile)
  }

  /** Writes each file's name again as its library's type reads it. */
  private rewriteNames({
    rows,
    kind,
  }: {
    rows: ReadonlyArray<{ id: number; fileName: string; folder: string }>
    kind: LibraryKind
  }): void {
    const update = this.db.prepare(
      'UPDATE media SET title = ?, year = ?, edition = ?, match = ? WHERE id = ?',
    )
    rows.forEach((row) => {
      const named = namedAs({ kind, fileName: row.fileName, folder: row.folder })
      update.run(named.title, named.year, named.edition, named.match, row.id)
    })
  }

  /** The files with these ids, in the order asked; one that is gone is left out. */
  byIds(ids: readonly number[]): MatchFile[] {
    if (ids.length === 0) return []
    const found = new Map(
      this.files({
        where: 'm.id IN (SELECT value FROM json_each(?))',
        params: [JSON.stringify(ids)],
      }).map((file) => [file.id, file]),
    )
    return ids.flatMap((id) => found.get(id) ?? [])
  }

  byId(id: number): MatchFile | null {
    return this.byIds([id])[0] ?? null
  }

  /** Every file that is an item, in any library, best first. */
  forItem(itemId: number): MatchFile[] {
    return this.files({
      where: 'm.id IN (SELECT media_id FROM media_items WHERE item_id = ?)',
      params: [itemId],
      order: BEST_FIRST,
    })
  }

  /** A library's files waiting to be matched, by place so a folder's files come together. */
  pending(libraryId: number): MatchFile[] {
    return this.files({ where: `m.library_id = ? AND m.match = 'pending'`, params: [libraryId] })
  }

  /** A library's files in `folder`, with their names, for the files sharing a place. */
  inFolder({ libraryId, folder }: { libraryId: number; folder: string }): MatchFile[] {
    return this.files({
      where: 'm.library_id = ? AND m.folder = ?',
      params: [libraryId, folder],
      order: 'm.file_name',
    })
  }

  /** A library's files in `folder` and every folder under it: a show's, season folders included. */
  underFolder({ libraryId, folder }: { libraryId: number; folder: string }): MatchFile[] {
    return this.files({
      where: `m.library_id = ? AND (m.folder = ? OR m.folder LIKE ? ESCAPE '\\')`,
      params: [libraryId, folder, `${escapeLike(folder)}/%`],
    })
  }

  /** How many files wait to be matched in libraries of `kinds`. */
  countPending(kinds: readonly LibraryKind[]): number {
    return (
      this.db
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) AS count FROM media m JOIN libraries l ON l.id = m.library_id
            WHERE m.match = 'pending' AND l.kind IN (SELECT value FROM json_each(?))`,
        )
        .get(JSON.stringify(kinds))?.count ?? 0
    )
  }

  setMatch({ ids, match }: { ids: readonly number[]; match: MatchState }): void {
    this.db
      .prepare('UPDATE media SET match = ? WHERE id IN (SELECT value FROM json_each(?))')
      .run(match, JSON.stringify(ids))
  }

  /**
   * Reads every file's name again for the library's type, and starts its
   * matching over: links go, and files are pending, or off in a library that
   * is not Movies or TV shows. Run when a library's type changes.
   */
  rename({ libraryId, kind }: { libraryId: number; kind: LibraryKind }): void {
    const rows = this.files({ where: 'm.library_id = ?', params: [libraryId] })
    this.db.transaction(() => {
      this.metadata.unlink(rows.map((row) => row.id))
      this.rewriteNames({ rows, kind })
    })()
  }

  /**
   * Reads names again without touching matches, for files indexed before
   * names were parsed. Only titles and years the parser now reads change.
   */
  retitle({ libraryId, kind }: { libraryId: number; kind: LibraryKind }): void {
    const rows = this.pending(libraryId)
    this.db.transaction(() => this.rewriteNames({ rows, kind }))()
  }

  /**
   * Puts a library's unmatched files back in the queue, for another search;
   * Fix match choices and extras stay. How many went back.
   */
  retryUnmatched(libraryId: number): number {
    return Number(
      this.db
        .prepare<[number]>(
          `UPDATE media SET match = 'pending' WHERE library_id = ? AND match = 'unmatched'`,
        )
        .run(libraryId).changes,
    )
  }
}
