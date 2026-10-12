import { Inject, Injectable } from '@nestjs/common'
import { type LibraryKind, type MatchedKind, type MatchState, isMatchState } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { BEST_FIRST, escapeLike } from '@/media/mediaSql'
import { namedAs } from '@/media/namedAs'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** A Fix match kept for a place: none, "this is not a movie or show", or a TMDB id. */
export type FixMatch = { kind: 'none' } | { kind: 'not-a-match' } | { kind: 'tmdb'; tmdbId: string }

/** What Fix match can keep for a place. */
export type FixMatchChoice = Exclude<FixMatch, { kind: 'none' }>

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
 * place with one, the Fix match kept for a place, and how matching went.
 * Only metadata matching uses it.
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

  /** Every file linked to the item or to anything under it, in any library, best first. */
  under(itemId: number): MatchFile[] {
    const ids = this.metadata.mediaUnder(itemId)
    if (ids.length === 0) return []
    return this.files({
      where: 'm.id IN (SELECT value FROM json_each(?))',
      params: [JSON.stringify(ids)],
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

  /** The Fix match kept for a place in a library. */
  fixMatchAt({ libraryId, place }: { libraryId: number; place: string }): FixMatch {
    const row = this.db
      .prepare<[number, string], { tmdb_id: string | null }>(
        'SELECT tmdb_id FROM match_overrides WHERE library_id = ? AND place = ?',
      )
      .get(libraryId, place)
    if (!row) return { kind: 'none' }
    return row.tmdb_id == null ? { kind: 'not-a-match' } : { kind: 'tmdb', tmdbId: row.tmdb_id }
  }

  /** Keeps a Fix match for a place, replacing the one it had. */
  saveFixMatch({
    libraryId,
    place,
    fix,
  }: {
    libraryId: number
    place: string
    fix: FixMatchChoice
  }): void {
    this.db
      .prepare(
        `INSERT INTO match_overrides (library_id, place, tmdb_id) VALUES (?, ?, ?)
         ON CONFLICT (library_id, place) DO UPDATE SET tmdb_id = excluded.tmdb_id`,
      )
      .run(libraryId, place, fix.kind === 'tmdb' ? fix.tmdbId : null)
  }

  /** How many files wait to be matched in libraries of `kinds`. */
  countPending(kinds: readonly MatchedKind[]): number {
    return (
      this.db
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) AS count FROM media m JOIN libraries l ON l.id = m.library_id
            WHERE m.match = 'pending' AND l.kind IN (SELECT value FROM json_each(?))`,
        )
        .get(JSON.stringify(kinds))?.count ?? 0
    )
  }

  /** Links files to their items, or to none, and records how matching went, together. */
  settle({
    ids,
    itemIds,
    match,
  }: {
    ids: readonly number[]
    itemIds: readonly number[]
    match: MatchState
  }): void {
    this.db.transaction(() => {
      if (itemIds.length === 0) this.metadata.unlink(ids)
      else this.metadata.link({ mediaIds: ids, itemIds })
      this.setMatch({ ids, match })
    })()
  }

  /** Starts files' matching over: their links go and they wait to be matched again. */
  reset(ids: readonly number[]): void {
    this.db.transaction(() => {
      this.metadata.unlink(ids)
      this.setMatch({ ids, match: 'pending' })
    })()
  }

  /**
   * Removes an item TMDB no longer has, and puts its files back: to pending,
   * or to unmatched where a Fix match pointed at it, in one go. The
   * libraries they are in, for another pass.
   */
  forgetItem(itemId: number): number[] {
    return this.db.transaction(() => {
      const files = this.byIds(this.metadata.mediaUnder(itemId))
      this.metadata.remove(itemId)
      const manual = files.filter((file) => file.match === 'manual').map((file) => file.id)
      const automatic = files.filter((file) => file.match !== 'manual').map((file) => file.id)
      this.setMatch({ ids: manual, match: 'unmatched' })
      this.setMatch({ ids: automatic, match: 'pending' })
      return [...new Set(files.map((file) => file.libraryId))]
    })()
  }

  setMatch({ ids, match }: { ids: readonly number[]; match: MatchState }): void {
    this.db
      .prepare('UPDATE media SET match = ? WHERE id IN (SELECT value FROM json_each(?))')
      .run(match, JSON.stringify(ids))
  }

  /**
   * Reads every file's name again for the library's type, and starts its
   * matching over: links go, and files are pending, or off in a library that
   * is not matched. Run when a library's type changes how its files are read.
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
