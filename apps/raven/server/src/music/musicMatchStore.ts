import { Inject, Injectable } from '@nestjs/common'
import { ALBUM_TYPES, MATCH_STATES } from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { type FolderFacts, folderFactsOf } from '@/music/albumTitles'
import { CREDITS, creditArtists } from '@/music/musicCredits'
import type { Release } from '@/music/musicBrainzClient'
import { reconcileAlbums } from '@/music/reconcileAlbums'
import { mergeSimilarAlbums } from '@/music/similarAlbums'
import { type StrayFold, foldStrayAlbums } from '@/music/strayAlbums'

type MusicMatchStoreTrackTitlesOfProps = { id: number; most: number }

type AlbumToMatchRow = {
  id: number
  title: string
  artist: string | null
  year: number | null
  track_count: number
  path: string | null
}

/** An album as a search reads it: its title, first artist, year and how many tracks are on disk. */
const SELECT_TO_MATCH = `SELECT a.id, a.title, a.year, COUNT(t.media_id) AS track_count, MIN(m.path) AS path,
                                (SELECT ar.name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
                                  WHERE aa.album_id = a.id ORDER BY aa.position LIMIT 1) AS artist
                           FROM albums a
                           LEFT JOIN tracks t ON t.album_id = a.id
                           LEFT JOIN media m ON m.id = t.media_id`

type MusicMatchStoreEnrichProps = { id: number; release: Release }

type MusicMatchStoreSaveMatchProps = {
  id: number
  release: Release | null
  match: typeof MATCH_STATES.matched | typeof MATCH_STATES.unmatched | typeof MATCH_STATES.manual
  /** How sure the pass was, 0 to 100; null for a Fix match. */
  confidence: number | null
}

/** An album as a MusicBrainz search reads it: what the tags and the files say of it. */
export type AlbumToMatch = {
  id: number
  title: string
  /** The first album artist's name; null for an album with none. */
  artist: string | null
  year: number | null
  trackCount: number
  /** What the album's folder's name says of it, which may be cleaner than its tags. */
  folder: FolderFacts | null
}

/** An album filed under a release whose MusicBrainz details are still to be read. */
type AlbumToEnrich = { id: number; mbid: string }

/** The music tables as matching reads and writes them: which release each album is, and how sure. */
@Injectable()
export class MusicMatchStore {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  private toAlbumToMatch(row: AlbumToMatchRow): AlbumToMatch {
    return {
      id: row.id,
      title: row.title,
      artist: row.artist,
      year: row.year,
      trackCount: row.track_count,
      folder: row.path === null ? null : folderFactsOf(row.path),
    }
  }

  albumsToEnrich(libraryId: number): AlbumToEnrich[] {
    return this.db
      .prepare<[number], { id: number; mbid: string }>(
        `SELECT a.id, a.mbid FROM albums a WHERE a.library_id = ? AND a.mbid IS NOT NULL
          AND ((a.fetched_at IS NULL AND (a.release_date IS NULL OR length(a.release_date) < 10))
            OR EXISTS (
              SELECT 1 FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
              WHERE aa.album_id = a.id AND ar.mbid IS NULL
            ))
          ORDER BY a.id`,
      )
      .all(libraryId)
  }

  enrich({ id, release }: MusicMatchStoreEnrichProps): void {
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE albums SET
      release_date = CASE WHEN release_date IS NULL OR
        (substr(release_date, 1, 4) = substr(@date, 1, 4) AND length(@date) > length(release_date))
        THEN COALESCE(@date, release_date) ELSE release_date END,
      year = COALESCE(year, @year), label = COALESCE(label, @label), fetched_at = @at
      WHERE id = @id AND mbid = @mbid`)
        .run({
          id,
          mbid: release.mbid,
          date: release.releaseDate,
          year: release.year,
          label: release.label,
          at: new Date().toISOString(),
        })
      if (release.artists.length > 0) {
        creditArtists({
          db: this.db,
          credits: CREDITS.album,
          ownerId: id,
          artists: release.artists,
        })
      }
    })()
  }

  /** The library's albums no pass has looked at yet, oldest first. */
  albumsToMatch(libraryId: number): AlbumToMatch[] {
    return this.db
      .prepare<[string, number], AlbumToMatchRow>(
        `${SELECT_TO_MATCH} WHERE a.match = ? AND a.library_id = ? GROUP BY a.id ORDER BY a.id`,
      )
      .all(MATCH_STATES.pending, libraryId)
      .map((row) => this.toAlbumToMatch(row))
  }

  /** One album as a search reads it, or null when there is no such album. */
  albumToMatch(id: number): AlbumToMatch | null {
    const row = this.db
      .prepare<[number], AlbumToMatchRow>(`${SELECT_TO_MATCH} WHERE a.id = ? GROUP BY a.id`)
      .get(id)
    return row === undefined ? null : this.toAlbumToMatch(row)
  }

  /**
   * What a pass or a Fix match decided: the release the album is, with
   * what MusicBrainz says of it filling in what the tags did not; or that
   * it is none, which takes an earlier release away. The archive's cover
   * follows the release id, so nothing of it is written here.
   */
  saveMatch({ id, release, match, confidence }: MusicMatchStoreSaveMatchProps): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE albums
            SET match = @match, match_confidence = @confidence, matched_at = @at,
                mbid = @mbid, fetched_at = CASE WHEN mbid IS @mbid THEN fetched_at ELSE NULL END,
                release_group_mbid = CASE WHEN @mbid IS NULL THEN NULL
                                          ELSE COALESCE(@releaseGroupMbid, release_group_mbid) END,
                year = COALESCE(year, @year),
                release_date = CASE WHEN release_date IS NULL OR
                  (substr(release_date, 1, 4) = substr(@releaseDate, 1, 4) AND length(@releaseDate) > length(release_date))
                  THEN COALESCE(@releaseDate, release_date) ELSE release_date END,
                label = COALESCE(label, @label),
                type = CASE WHEN type = @plain AND @type IS NOT NULL THEN @type ELSE type END
          WHERE id = @id`,
        )
        .run({
          id,
          match,
          confidence,
          at: new Date().toISOString(),
          mbid: release?.mbid ?? null,
          releaseGroupMbid: release?.releaseGroupMbid ?? null,
          year: release?.year ?? null,
          releaseDate: release?.releaseDate ?? null,
          label: release?.label ?? null,
          type: release?.type ?? null,
          plain: ALBUM_TYPES.album,
        })
      if (release !== null && release.artists.length > 0) {
        creditArtists({
          db: this.db,
          credits: CREDITS.album,
          ownerId: id,
          artists: release.artists,
        })
      }
    })()
  }

  /** How many of the library's albums no release was found for. */
  unmatchedCount(libraryId: number): number {
    return (
      this.db
        .prepare<[number, string], { total: number }>(
          'SELECT COUNT(*) AS total FROM albums WHERE library_id = ? AND match = ?',
        )
        .get(libraryId, MATCH_STATES.unmatched)?.total ?? 0
    )
  }

  /** An album's track titles in disc and track order, the first `most`, for Claude to read. */
  trackTitlesOf({ id, most }: MusicMatchStoreTrackTitlesOfProps): string[] {
    return this.db
      .prepare<[number, number], { title: string }>(
        'SELECT title FROM tracks WHERE album_id = ? ORDER BY disc, number, media_id LIMIT ?',
      )
      .all(id, most)
      .map(({ title }) => title)
  }

  /** Folds the library's unmatched albums whose tracks belong to another album by where they sit (`foldStrayAlbums`). */
  foldStrays(libraryId: number): StrayFold[] {
    return foldStrayAlbums({ db: this.db, libraryId })
  }

  /** The library's albums no release was found for go back to pending; how many. */
  resetUnmatched(libraryId: number): number {
    return this.db
      .prepare('UPDATE albums SET match = ? WHERE library_id = ? AND match = ?')
      .run(MATCH_STATES.pending, libraryId, MATCH_STATES.unmatched).changes
  }

  /**
   * Looks through a library and folds every album that is the same release as
   * another into one, by release id or by title, year, track count and artist.
   * How many albums went.
   */
  mergeAlbums(libraryId: number): number {
    const count = (): number =>
      this.db
        .prepare<[number], { total: number }>(
          'SELECT COUNT(*) AS total FROM albums WHERE library_id = ?',
        )
        .get(libraryId)?.total ?? 0
    return this.db.transaction(() => {
      const before = count()
      mergeSimilarAlbums({ db: this.db, libraryId })
      reconcileAlbums({ db: this.db })
      return before - count()
    })()
  }
}
