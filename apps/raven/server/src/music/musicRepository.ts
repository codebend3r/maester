import { Inject, Injectable } from '@nestjs/common'
import {
  ALBUM_TYPES,
  type AlbumDetails,
  MATCH_STATES,
  type AlbumSummary,
  type Artist,
  type ArtistCredit,
  type ArtistDetails,
  MUSIC_SORTS,
  type MusicListParams,
  type MusicSort,
  type Track,
  isAlbumType,
  isArtistCredit,
  isMatchState,
  isStringArray,
  listOf,
  sortTitle,
} from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import { likePattern } from '@/media/mediaSql'
import { PictureVersions } from '@/metadata/pictureVersions'
import type { AudioFormat, AudioTags } from '@/music/audioReader'
import { type Filing, type NamedArtist, albumTypeOf, filingOf, nameKeyOf } from '@/music/filing'
import type { Release } from '@/music/musicBrainzClient'

/** Where an album's cover comes from: a picture embedded in one of its files, a file in its folder, or the Cover Art Archive. */
export const COVER_SOURCES = { embedded: 'embedded', file: 'file', coverArtArchive: 'caa' } as const

/** An album's cover: the media id of the file that embeds it, the path of the picture in its folder, or the release id the archive files it under. */
export type AlbumCover = {
  source: (typeof COVER_SOURCES)[keyof typeof COVER_SOURCES]
  ref: string
}

const isCoverSource = (value: unknown): value is AlbumCover['source'] =>
  Object.values(COVER_SOURCES).some((source) => source === value)

const isArtistCredits = listOf(isArtistCredit)

type AlbumRow = {
  id: number
  library_id: number
  title: string
  sort_title: string
  year: number | null
  type: string
  is_compilation: number
  cover_source: string | null
  cover_ref: string | null
  mbid: string | null
  match: string
  added_at: string
  artists: string
  track_count: number
  duration: number | null
}

/** An album as a MusicBrainz search reads it: what the tags and the files say of it. */
export type AlbumToMatch = {
  id: number
  title: string
  /** The first album artist's name; null for an album with none. */
  artist: string | null
  year: number | null
  trackCount: number
}

type AlbumToMatchRow = {
  id: number
  title: string
  artist: string | null
  year: number | null
  track_count: number
}

type AlbumDetailsRow = AlbumRow & {
  label: string | null
  genres: string
  mbid: string | null
  disc_count: number
}

type TrackRow = {
  media_id: number
  library_id: number
  album_id: number
  title: string
  disc: number
  number: number | null
  duration: number | null
  container: string
  audio_codec: string | null
  bitrate: number | null
  sample_rate: number | null
  bit_depth: number | null
  is_lossless: number
  mbid: string | null
  added_at: string
  artists: string
}

type ArtistRow = {
  id: number
  name: string
  sort_name: string
  mbid: string | null
  album_count: number
  track_count: number
}

/** An album's artists in credit order, as one JSON list per row. */
const ALBUM_ARTISTS = `(SELECT json_group_array(json_object('id', credited.id, 'name', credited.name))
                           FROM (SELECT ar.id, ar.name
                                   FROM album_artists aa
                                   JOIN artists ar ON ar.id = aa.artist_id
                                  WHERE aa.album_id = a.id
                                  ORDER BY aa.position) credited)`

const TRACK_ARTISTS = `(SELECT json_group_array(json_object('id', credited.id, 'name', credited.name))
                           FROM (SELECT ar.id, ar.name
                                   FROM track_artists ta
                                   JOIN artists ar ON ar.id = ta.artist_id
                                  WHERE ta.media_id = m.id
                                  ORDER BY ta.position) credited)`

/** An album with its credits, track count and length; `more` adds columns the album's page reads. */
const selectAlbums = (more = ''): string =>
  `SELECT a.id, a.library_id, a.title, a.sort_title, a.year, a.type, a.is_compilation,
          a.cover_source, a.cover_ref, a.mbid, a.match, a.added_at, ${ALBUM_ARTISTS} AS artists,
          COUNT(t.media_id) AS track_count, SUM(m.duration) AS duration${more}
     FROM albums a
     LEFT JOIN tracks t ON t.album_id = a.id
     LEFT JOIN media m ON m.id = t.media_id`

const SELECT_ALBUMS = selectAlbums()

const SELECT_ALBUM_DETAILS = selectAlbums(
  ', a.label, a.genres, a.mbid, COUNT(DISTINCT t.disc) AS disc_count',
)

const SELECT_TRACKS = `SELECT m.id AS media_id, m.library_id, t.album_id, t.title, t.disc, t.number,
                              m.duration, m.container, m.audio_codec, m.bitrate, t.sample_rate,
                              t.bit_depth, t.is_lossless, t.mbid, m.added_at,
                              ${TRACK_ARTISTS} AS artists
                         FROM tracks t
                         JOIN media m ON m.id = t.media_id
                         JOIN albums a ON a.id = t.album_id`

/** An album as a search reads it: its title, first artist, year and how many tracks are on disk. */
const SELECT_TO_MATCH = `SELECT a.id, a.title, a.year, COUNT(t.media_id) AS track_count,
                                (SELECT ar.name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
                                  WHERE aa.album_id = a.id ORDER BY aa.position LIMIT 1) AS artist
                           FROM albums a
                           LEFT JOIN tracks t ON t.album_id = a.id`

/** The first album artist's sort name, for a listing by artist. */
const FIRST_ARTIST = `(SELECT ar.sort_name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
                        WHERE aa.album_id = a.id ORDER BY aa.position LIMIT 1)`

/** Albums as a discography reads: by year, the undated last, then by title. */
const BY_ALBUM = 'a.year IS NULL, a.year, a.sort_title COLLATE NOCASE'

const ALBUM_ORDER: Record<MusicSort, string> = {
  [MUSIC_SORTS.title]: 'a.sort_title COLLATE NOCASE, a.id',
  [MUSIC_SORTS.artist]: `${FIRST_ARTIST} COLLATE NOCASE, ${BY_ALBUM}, a.id`,
  [MUSIC_SORTS.year]: `${BY_ALBUM}, a.id`,
  [MUSIC_SORTS.added]: 'a.added_at DESC, a.id DESC',
}

const TRACK_ORDER: Record<MusicSort, string> = {
  [MUSIC_SORTS.title]: 't.title COLLATE NOCASE, m.id',
  [MUSIC_SORTS.artist]: `${FIRST_ARTIST} COLLATE NOCASE, ${BY_ALBUM}, t.disc, t.number, m.id`,
  [MUSIC_SORTS.year]: `${BY_ALBUM}, t.disc, t.number, m.id`,
  [MUSIC_SORTS.added]: 'm.added_at DESC, m.id DESC',
}

/** Where an album's or a track's search looks: the title, and the names of its artists. */
const ALBUM_SEARCH = `(a.title LIKE @pattern ESCAPE '\\' OR EXISTS (
                         SELECT 1 FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
                          WHERE aa.album_id = a.id AND ar.name LIKE @pattern ESCAPE '\\'))`

const TRACK_SEARCH = `(t.title LIKE @pattern ESCAPE '\\' OR a.title LIKE @pattern ESCAPE '\\'
                       OR EXISTS (
                         SELECT 1 FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id
                          WHERE ta.media_id = m.id AND ar.name LIKE @pattern ESCAPE '\\'))`

/** The credit tables, each keyed by what it credits. */
const CREDITS = {
  album: { table: 'album_artists', owner: 'album_id' },
  track: { table: 'track_artists', owner: 'media_id' },
} as const

const creditsOf = (json: string): ArtistCredit[] =>
  parseJsonAs({ json, guard: isArtistCredits }) ?? []

type CoverOfProps = { source: string | null; ref: string | null; mbid: string | null }

/**
 * An album's cover: the one its files or folder gave it, else the Cover
 * Art Archive's by its release id, which is never stored as a cover so a
 * picture that turns up beside the files later still wins.
 */
const coverOf = ({ source, ref, mbid }: CoverOfProps): AlbumCover | null =>
  isCoverSource(source) && ref != null
    ? { source, ref }
    : mbid === null
      ? null
      : { source: COVER_SOURCES.coverArtArchive, ref: mbid }

type MusicRepositoryRecordProps = {
  mediaId: number
  libraryId: number
  path: string
  tags: AudioTags
  format: AudioFormat
  /** A cover found in the file's folder, for an album with none whose file embeds none. */
  folderCover: string | null
  at?: Date
}

type MusicRepositoryInsertAlbumProps = {
  libraryId: number
  filing: Filing
  tags: AudioTags
  cover: AlbumCover | null
  at: Date
}

type MusicRepositoryFillAlbumProps = {
  id: number
  tags: AudioTags
  cover: AlbumCover | null
}

type MusicRepositoryRecreditAlbumProps = { id: number; filing: Filing }

type MusicRepositoryCreditProps = {
  credits: (typeof CREDITS)[keyof typeof CREDITS]
  ownerId: number
  artists: readonly NamedArtist[]
}

type MusicRepositoryListArtistsProps = { libraryId: number } & Pick<MusicListParams, 'search'>

type MusicRepositoryListAlbumsProps = { libraryId: number } & Pick<
  MusicListParams,
  'search' | 'sort'
>

type MusicRepositoryListTracksProps = { libraryId: number } & MusicListParams

type MusicRepositoryArtistProps = {
  id: number
  /** Whether the caller sees a library, so a locked one's albums stay out of the page. */
  seesLibrary: (libraryId: number) => boolean
}

type MusicRepositoryCoverProps = { id: number; version: string }

type MusicRepositorySaveMatchProps = {
  id: number
  release: Release | null
  match: typeof MATCH_STATES.matched | typeof MATCH_STATES.unmatched | typeof MATCH_STATES.manual
  /** How sure the pass was, 0 to 100; null for a Fix match. */
  confidence: number | null
}

/**
 * The music tables: what a scan writes of each audio file's tags, and the
 * artists, albums and tracks the clients list. Every album reads as an
 * `AlbumSummary`, which has no path; what the server needs of a file itself
 * stays `MediaIndex`'s.
 */
@Injectable()
export class MusicRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PictureVersions) private readonly pictureVersions: PictureVersions,
  ) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  private toAlbum(row: AlbumRow): AlbumSummary {
    return {
      id: row.id,
      libraryId: row.library_id,
      title: row.title,
      sortTitle: row.sort_title,
      year: row.year,
      type: isAlbumType(row.type) ? row.type : ALBUM_TYPES.album,
      artists: creditsOf(row.artists),
      isCompilation: row.is_compilation === 1,
      trackCount: row.track_count,
      duration: row.duration ?? 0,
      coverVersion: this.pictureVersions.album({
        id: row.id,
        cover: coverOf({ source: row.cover_source, ref: row.cover_ref, mbid: row.mbid }),
      }),
      match: isMatchState(row.match) ? row.match : MATCH_STATES.pending,
      addedAt: row.added_at,
    }
  }

  private toTrack(row: TrackRow): Track {
    return {
      id: row.media_id,
      libraryId: row.library_id,
      albumId: row.album_id,
      title: row.title,
      disc: row.disc,
      number: row.number,
      duration: row.duration,
      artists: creditsOf(row.artists),
      container: row.container,
      codec: row.audio_codec,
      bitrate: row.bitrate,
      sampleRate: row.sample_rate,
      bitDepth: row.bit_depth,
      isLossless: row.is_lossless === 1,
      mbid: row.mbid,
      addedAt: row.added_at,
    }
  }

  private toArtist(row: ArtistRow): Artist {
    return {
      id: row.id,
      name: row.name,
      sortName: row.sort_name,
      mbid: row.mbid,
      albumCount: row.album_count,
      trackCount: row.track_count,
    }
  }

  /** The artist's row, found by id, else by name; made when there is none. An id learnt later is kept. */
  private artistId({ name, mbid }: NamedArtist): number {
    const byMbid =
      mbid === null
        ? undefined
        : this.db
            .prepare<[string], { id: number }>('SELECT id FROM artists WHERE mbid = ?')
            .get(mbid)
    if (byMbid) return byMbid.id
    const nameKey = nameKeyOf(name)
    const byName = this.db
      .prepare<[string], { id: number; mbid: string | null }>(
        'SELECT id, mbid FROM artists WHERE name_key = ?',
      )
      .get(nameKey)
    if (byName) {
      if (mbid !== null && byName.mbid === null) {
        this.db.prepare('UPDATE artists SET mbid = ? WHERE id = ?').run(mbid, byName.id)
      }
      return byName.id
    }
    const inserted = this.db
      .prepare('INSERT INTO artists (name, sort_name, name_key, mbid) VALUES (?, ?, ?, ?)')
      .run(name, sortTitle(name), nameKey, mbid)
    return Number(inserted.lastInsertRowid)
  }

  /** Credits `artists` on an album or a track in their order, in place of whoever was credited before; the same artist named twice is credited once. */
  private credit({ credits, ownerId, artists }: MusicRepositoryCreditProps): void {
    this.db.prepare(`DELETE FROM ${credits.table} WHERE ${credits.owner} = ?`).run(ownerId)
    const insert = this.db.prepare(
      `INSERT INTO ${credits.table} (${credits.owner}, artist_id, position) VALUES (?, ?, ?)`,
    )
    const distinct = [...new Set(artists.map((artist) => this.artistId(artist)))]
    distinct.forEach((artistId, position) => insert.run(ownerId, artistId, position))
  }

  /** The first file of an album names it, its artists and everything else its tags say. */
  private insertAlbum({
    libraryId,
    filing,
    tags,
    cover,
    at,
  }: MusicRepositoryInsertAlbumProps): number {
    const inserted = this.db
      .prepare(
        `INSERT INTO albums (library_id, album_key, title, sort_title, year, original_year, mbid,
                             release_group_mbid, type, label, genres, is_compilation, credited_by_tags,
                             cover_source, cover_ref, replaygain_gain, replaygain_peak, added_at,
                             match, matched_at)
         VALUES (@libraryId, @key, @title, @sortTitle, @year, @originalYear, @mbid,
                 @releaseGroupMbid, @type, @label, @genres, @isCompilation, @isCredited,
                 @coverSource, @coverRef, @gain, @peak, @addedAt, @match, @matchedAt)`,
      )
      .run({
        libraryId,
        key: filing.albumKey,
        title: filing.albumTitle,
        sortTitle: sortTitle(filing.albumTitle),
        year: tags.year,
        originalYear: tags.originalYear,
        mbid: tags.releaseMbid,
        releaseGroupMbid: tags.releaseGroupMbid,
        type: albumTypeOf(tags),
        label: tags.label,
        genres: JSON.stringify(tags.genres),
        isCompilation: tags.isCompilation ? 1 : 0,
        isCredited: filing.isAlbumCredited ? 1 : 0,
        coverSource: cover?.source ?? null,
        coverRef: cover?.ref ?? null,
        gain: tags.replayGain.albumGain,
        peak: tags.replayGain.albumPeak,
        addedAt: at.toISOString(),
        // A release id in the tags is a match already; MusicBrainz is asked for the rest.
        match: tags.releaseMbid === null ? MATCH_STATES.pending : MATCH_STATES.matched,
        matchedAt: tags.releaseMbid === null ? null : at.toISOString(),
      })
    const id = Number(inserted.lastInsertRowid)
    this.credit({ credits: CREDITS.album, ownerId: id, artists: filing.albumArtists })
    return id
  }

  /** A later file fills in what the album did not know, its ids and its cover above all, and never overwrites what it did. */
  private fillAlbum({ id, tags, cover }: MusicRepositoryFillAlbumProps): void {
    this.db
      .prepare(
        `UPDATE albums
            SET year = COALESCE(year, @year), original_year = COALESCE(original_year, @originalYear),
                match = CASE WHEN mbid IS NULL AND @mbid IS NOT NULL AND match <> @manual
                             THEN @matched ELSE match END,
                matched_at = CASE WHEN mbid IS NULL AND @mbid IS NOT NULL AND match <> @manual
                                  THEN @at ELSE matched_at END,
                mbid = CASE WHEN match = @manual THEN mbid ELSE COALESCE(mbid, @mbid) END,
                release_group_mbid = CASE WHEN match = @manual THEN release_group_mbid
                                          ELSE COALESCE(release_group_mbid, @releaseGroupMbid) END,
                label = COALESCE(label, @label),
                genres = CASE WHEN genres = '[]' THEN @genres ELSE genres END,
                cover_ref = CASE WHEN cover_source IS NULL THEN @coverRef ELSE cover_ref END,
                cover_source = COALESCE(cover_source, @coverSource),
                replaygain_gain = COALESCE(replaygain_gain, @gain),
                replaygain_peak = COALESCE(replaygain_peak, @peak)
          WHERE id = @id`,
      )
      .run({
        id,
        year: tags.year,
        originalYear: tags.originalYear,
        mbid: tags.releaseMbid,
        releaseGroupMbid: tags.releaseGroupMbid,
        label: tags.label,
        genres: JSON.stringify(tags.genres),
        coverSource: cover?.source ?? null,
        coverRef: cover?.ref ?? null,
        gain: tags.replayGain.albumGain,
        peak: tags.replayGain.albumPeak,
        matched: MATCH_STATES.matched,
        manual: MATCH_STATES.manual,
        at: new Date().toISOString(),
      })
  }

  /** Album credits that stood in from a track, a folder or a fallback give way to the first file whose tags name the album's artists. */
  private recreditAlbum({ id, filing }: MusicRepositoryRecreditAlbumProps): void {
    const changed = this.db
      .prepare('UPDATE albums SET credited_by_tags = 1 WHERE id = ? AND credited_by_tags = 0')
      .run(id)
    if (changed.changes === 0) return
    this.credit({ credits: CREDITS.album, ownerId: id, artists: filing.albumArtists })
  }

  /**
   * Files one audio file under its album and artists from what its tags
   * say, in one write. A file read again (replaced, or on a full scan)
   * moves to the album its tags now name, and the album it leaves goes
   * with it when it was its last track.
   */
  record({
    mediaId,
    libraryId,
    path,
    tags,
    format,
    folderCover,
    at = new Date(),
  }: MusicRepositoryRecordProps): void {
    const filing = filingOf({ tags, path })
    const cover: AlbumCover | null = tags.hasCover
      ? { source: COVER_SOURCES.embedded, ref: String(mediaId) }
      : folderCover === null
        ? null
        : { source: COVER_SOURCES.file, ref: folderCover }
    this.db.transaction(() => {
      const existing = this.db
        .prepare<[number, string], { id: number }>(
          'SELECT id FROM albums WHERE library_id = ? AND album_key = ?',
        )
        .get(libraryId, filing.albumKey)
      const albumId = existing?.id ?? this.insertAlbum({ libraryId, filing, tags, cover, at })
      if (existing) {
        this.fillAlbum({ id: albumId, tags, cover })
        if (filing.isAlbumCredited) this.recreditAlbum({ id: albumId, filing })
      }
      this.db
        .prepare(
          `INSERT OR REPLACE INTO tracks (media_id, album_id, disc, number, title, mbid, isrc, sample_rate,
                                          bit_depth, is_lossless, replaygain_gain, replaygain_peak)
           VALUES (@mediaId, @albumId, @disc, @number, @title, @mbid, @isrc, @sampleRate,
                   @bitDepth, @isLossless, @gain, @peak)`,
        )
        .run({
          mediaId,
          albumId,
          disc: tags.disc ?? 1,
          number: tags.trackNumber,
          title: filing.trackTitle,
          mbid: tags.recordingMbid,
          isrc: tags.isrc,
          sampleRate: format.sampleRate,
          bitDepth: format.bitDepth,
          isLossless: format.isLossless ? 1 : 0,
          gain: tags.replayGain.trackGain,
          peak: tags.replayGain.trackPeak,
        })
      this.credit({ credits: CREDITS.track, ownerId: mediaId, artists: filing.trackArtists })
      this.prune()
    })()
  }

  /**
   * Drops the albums with no track left and the artists credited on
   * nothing, and lets an album whose cover was in a file now gone take one
   * from the next file read. Cheap, so it runs after every write and every
   * removal of media, whatever kind of files went.
   */
  prune(): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)')
      this.db
        .prepare(
          `UPDATE albums SET cover_source = NULL, cover_ref = NULL
            WHERE cover_source = ? AND CAST(cover_ref AS INTEGER) NOT IN (SELECT media_id FROM tracks)`,
        )
        .run(COVER_SOURCES.embedded)
      this.db.exec(`
        DELETE FROM artists
         WHERE id NOT IN (SELECT artist_id FROM album_artists)
           AND id NOT IN (SELECT artist_id FROM track_artists)`)
    })()
  }

  private toAlbumToMatch(row: AlbumToMatchRow): AlbumToMatch {
    return {
      id: row.id,
      title: row.title,
      artist: row.artist,
      year: row.year,
      trackCount: row.track_count,
    }
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
  saveMatch({ id, release, match, confidence }: MusicRepositorySaveMatchProps): void {
    this.db
      .prepare(
        `UPDATE albums
            SET match = @match, match_confidence = @confidence, matched_at = @at,
                mbid = @mbid,
                release_group_mbid = CASE WHEN @mbid IS NULL THEN NULL
                                          ELSE COALESCE(@releaseGroupMbid, release_group_mbid) END,
                year = COALESCE(year, @year),
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
        label: release?.label ?? null,
        type: release?.type ?? null,
        plain: ALBUM_TYPES.album,
      })
  }

  /** The library's albums no release was found for go back to pending; how many. */
  resetUnmatched(libraryId: number): number {
    return this.db
      .prepare('UPDATE albums SET match = ? WHERE library_id = ? AND match = ?')
      .run(MATCH_STATES.pending, libraryId, MATCH_STATES.unmatched).changes
  }

  /** The library an album is in, or null when there is no such album. */
  libraryOfAlbum(id: number): number | null {
    return (
      this.db
        .prepare<[number], { library_id: number }>('SELECT library_id FROM albums WHERE id = ?')
        .get(id)?.library_id ?? null
    )
  }

  /** Every album's id, and every release id an album shows the archive's cover of, for the image cache's sweep. */
  keptCovers(): { albumIds: Set<number>; coverArtIds: Set<string> } {
    const rows = this.db
      .prepare<[], { id: number; mbid: string | null }>('SELECT id, mbid FROM albums')
      .all()
    return {
      albumIds: new Set(rows.map((row) => row.id)),
      coverArtIds: new Set(rows.flatMap((row) => (row.mbid === null ? [] : [row.mbid]))),
    }
  }

  /**
   * Where an album's cover is read from, when `version` is its current
   * one: the file that embeds it, or the picture in its folder. Null for
   * another version, or an album with no cover.
   */
  cover({ id, version }: MusicRepositoryCoverProps): AlbumCover | null {
    const row = this.db
      .prepare<[number], CoverOfProps>(
        'SELECT cover_source AS source, cover_ref AS ref, mbid FROM albums WHERE id = ?',
      )
      .get(id)
    const cover = row === undefined ? null : coverOf(row)
    return cover !== null && this.pictureVersions.album({ id, cover }) === version ? cover : null
  }

  /** A library's artists, by name, each with how many of that library's albums and tracks credit them. */
  listArtists({ libraryId, search }: MusicRepositoryListArtistsProps): Artist[] {
    return this.db
      .prepare<{ libraryId: number; pattern: string }, ArtistRow>(
        `SELECT ar.id, ar.name, ar.sort_name, ar.mbid,
                (SELECT COUNT(*) FROM album_artists aa JOIN albums a ON a.id = aa.album_id
                  WHERE aa.artist_id = ar.id AND a.library_id = @libraryId) AS album_count,
                (SELECT COUNT(*) FROM track_artists ta JOIN media m ON m.id = ta.media_id
                  WHERE ta.artist_id = ar.id AND m.library_id = @libraryId) AS track_count
           FROM artists ar
          WHERE ar.name LIKE @pattern ESCAPE '\\'
            AND (EXISTS (SELECT 1 FROM album_artists aa JOIN albums a ON a.id = aa.album_id
                          WHERE aa.artist_id = ar.id AND a.library_id = @libraryId)
                 OR EXISTS (SELECT 1 FROM track_artists ta JOIN media m ON m.id = ta.media_id
                             WHERE ta.artist_id = ar.id AND m.library_id = @libraryId))
          ORDER BY ar.sort_name COLLATE NOCASE, ar.id`,
      )
      .all({ libraryId, pattern: likePattern(search.trim()) })
      .map((row) => this.toArtist(row))
  }

  /** A library's albums in `sort` order; search matches the title and the artists' names. */
  listAlbums({ libraryId, search, sort }: MusicRepositoryListAlbumsProps): AlbumSummary[] {
    return this.db
      .prepare<{ libraryId: number; pattern: string }, AlbumRow>(
        `${SELECT_ALBUMS}
          WHERE a.library_id = @libraryId AND ${ALBUM_SEARCH}
          GROUP BY a.id
          ORDER BY ${ALBUM_ORDER[sort]}`,
      )
      .all({ libraryId, pattern: likePattern(search.trim()) })
      .map((row) => this.toAlbum(row))
  }

  /** One page of a library's tracks in `sort` order, and how many the listing holds in all. */
  listTracks({ libraryId, search, sort, limit, offset }: MusicRepositoryListTracksProps): {
    tracks: Track[]
    total: number
  } {
    const params = { libraryId, pattern: likePattern(search.trim()), limit, offset }
    const tracks = this.db
      .prepare<typeof params, TrackRow>(
        `${SELECT_TRACKS}
          WHERE m.library_id = @libraryId AND ${TRACK_SEARCH}
          ORDER BY ${TRACK_ORDER[sort]}
          LIMIT @limit OFFSET @offset`,
      )
      .all(params)
      .map((row) => this.toTrack(row))
    const total =
      this.db
        .prepare<typeof params, { total: number }>(
          `SELECT COUNT(*) AS total
             FROM tracks t JOIN media m ON m.id = t.media_id JOIN albums a ON a.id = t.album_id
            WHERE m.library_id = @libraryId AND ${TRACK_SEARCH}`,
        )
        .get(params)?.total ?? 0
    return { tracks, total }
  }

  /** An album with its tracks in disc and number order, or null when there is no such album. */
  album(id: number): AlbumDetails | null {
    const row = this.db
      .prepare<[number], AlbumDetailsRow>(`${SELECT_ALBUM_DETAILS} WHERE a.id = ? GROUP BY a.id`)
      .get(id)
    if (!row) return null
    const tracks = this.db
      .prepare<[number], TrackRow>(
        `${SELECT_TRACKS} WHERE t.album_id = ?
          ORDER BY t.disc, t.number IS NULL, t.number, t.title COLLATE NOCASE, m.id`,
      )
      .all(id)
      .map((track) => this.toTrack(track))
    return {
      album: this.toAlbum(row),
      label: row.label,
      genres: parseJsonAs({ json: row.genres, guard: isStringArray }) ?? [],
      mbid: row.mbid,
      discCount: Math.max(row.disc_count, 1),
      tracks,
    }
  }

  /**
   * An artist's page: their albums, then the albums of others they are
   * credited on a track of, each in the libraries the caller sees, and
   * their counts over those; null when there is no such artist.
   */
  artist({ id, seesLibrary }: MusicRepositoryArtistProps): ArtistDetails | null {
    const row = this.db
      .prepare<[number], Omit<ArtistRow, 'album_count' | 'track_count'>>(
        'SELECT id, name, sort_name, mbid FROM artists WHERE id = ?',
      )
      .get(id)
    if (!row) return null
    const albums = this.db
      .prepare<[number], AlbumRow>(
        `${SELECT_ALBUMS}
          WHERE a.id IN (SELECT album_id FROM album_artists WHERE artist_id = ?)
          GROUP BY a.id
          ORDER BY ${BY_ALBUM}, a.id`,
      )
      .all(id)
      .map((album) => this.toAlbum(album))
      .filter((album) => seesLibrary(album.libraryId))
    const appearsOn = this.db
      .prepare<[number, number], AlbumRow>(
        `${SELECT_ALBUMS}
          WHERE a.id IN (SELECT t2.album_id FROM track_artists ta JOIN tracks t2 ON t2.media_id = ta.media_id
                          WHERE ta.artist_id = ?)
            AND a.id NOT IN (SELECT album_id FROM album_artists WHERE artist_id = ?)
          GROUP BY a.id
          ORDER BY ${BY_ALBUM}, a.id`,
      )
      .all(id, id)
      .map((album) => this.toAlbum(album))
      .filter((album) => seesLibrary(album.libraryId))
    const seen = [...albums, ...appearsOn].map((album) => album.id)
    const trackCount =
      this.db
        .prepare<[number, string], { count: number }>(
          `SELECT COUNT(*) AS count FROM track_artists ta JOIN tracks t ON t.media_id = ta.media_id
            WHERE ta.artist_id = ? AND t.album_id IN (SELECT value FROM json_each(?))`,
        )
        .get(id, JSON.stringify(seen))?.count ?? 0
    return {
      artist: this.toArtist({ ...row, album_count: albums.length, track_count: trackCount }),
      albums,
      appearsOn,
    }
  }
}
