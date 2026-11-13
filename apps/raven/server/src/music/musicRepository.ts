import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import {
  ALBUM_TYPES,
  type AlbumDetails,
  MATCH_STATES,
  type AlbumSummary,
  type MediaAlbum,
  type Artist,
  type ArtistDetails,
  MUSIC_SORTS,
  SORT_DIRECTIONS,
  type MusicListParams,
  type MusicSort,
  type Track,
  isAlbumType,
  isMatchState,
  isStringArray,
  sortTitle,
} from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import { likePattern } from '@/media/mediaSql'
import type { ByAccount } from '@/media/viewingAccountKeys'
import { PictureVersions } from '@/metadata/pictureVersions'
import type { AudioFormat, AudioTags } from '@/music/audioReader'
import { type Filing, albumTypeOf, albumFolderOf, discOfPath, filingOf } from '@/music/filing'
import { REPLAYGAIN_SOURCES } from '@/music/loudness'
import { CREDITS, creditArtists, creditsOf } from '@/music/musicCredits'
import { type AlbumCover, COVER_SOURCES, type CoverOfProps, coverOf } from '@/music/musicCoverStore'
import { reconcileAlbums } from '@/music/reconcileAlbums'

type AlbumRow = {
  id: number
  library_id: number
  title: string
  sort_title: string
  year: number | null
  release_date: string | null
  type: string
  is_compilation: number
  cover_source: string | null
  cover_ref: string | null
  cover_stamp: string
  mbid: string | null
  match: string
  added_at: string
  artists: string
  track_count: number
  duration: number | null
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
  album_title: string
  album_cover_source: string | null
  album_cover_ref: string | null
  album_cover_stamp: string
  album_mbid: string | null
  track_gain: number | null
  track_peak: number | null
  album_gain: number | null
  album_peak: number | null
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

/** A track's artists in credit order, as one JSON list per row of media `m`. */
export const TRACK_ARTISTS = `(SELECT json_group_array(json_object('id', credited.id, 'name', credited.name))
                           FROM (SELECT ar.id, ar.name
                                   FROM track_artists ta
                                   JOIN artists ar ON ar.id = ta.artist_id
                                  WHERE ta.media_id = m.id
                                  ORDER BY ta.position) credited)`

/**
 * A track unless the album holds another copy of it (same disc, number and title)
 * that is better: more bits, then a higher sample rate, then the earlier file.
 * Merged albums hold both copies of a release's files; each track shows once.
 */
const SHOWN_TRACK = `NOT EXISTS (
  SELECT 1 FROM tracks copy
   WHERE copy.album_id = t.album_id AND copy.media_id <> t.media_id AND copy.disc = t.disc
     AND copy.number = t.number AND lower(copy.title) = lower(t.title)
     AND (COALESCE(copy.bit_depth, 0) * 10000000 + COALESCE(copy.sample_rate, 0), -copy.media_id)
       > (COALESCE(t.bit_depth, 0) * 10000000 + COALESCE(t.sample_rate, 0), -t.media_id))`

/** An album with its credits, track count and length; `more` adds columns the album's page reads. */
const selectAlbums = (more = ''): string =>
  `SELECT a.id, a.library_id, a.title, a.sort_title, a.year, a.release_date, a.type, a.is_compilation,
          a.cover_source, a.cover_ref, a.cover_stamp, a.mbid, a.match, a.added_at, ${ALBUM_ARTISTS} AS artists,
          COUNT(t.media_id) AS track_count, SUM(m.duration) AS duration${more}
     FROM albums a
     LEFT JOIN tracks t ON t.album_id = a.id AND ${SHOWN_TRACK}
     LEFT JOIN media m ON m.id = t.media_id`

const SELECT_ALBUMS = selectAlbums()

const SELECT_ALBUM_DETAILS = selectAlbums(
  ', a.label, a.genres, a.mbid, COUNT(DISTINCT t.disc) AS disc_count',
)

const SELECT_TRACKS = `SELECT m.id AS media_id, m.library_id, t.album_id, t.title, t.disc, t.number,
                              m.duration, m.container, m.audio_codec, m.bitrate, t.sample_rate,
                              t.bit_depth, t.is_lossless, t.mbid, m.added_at,
                              ${TRACK_ARTISTS} AS artists,
                              a.title AS album_title, a.cover_source AS album_cover_source,
                              a.cover_ref AS album_cover_ref, a.cover_stamp AS album_cover_stamp, a.mbid AS album_mbid,
                              t.replaygain_gain AS track_gain, t.replaygain_peak AS track_peak,
                              a.replaygain_gain AS album_gain, a.replaygain_peak AS album_peak
                         FROM tracks t
                         JOIN media m ON m.id = t.media_id
                         JOIN albums a ON a.id = t.album_id`

/** The first album artist's sort name, for a listing by artist. */
const FIRST_ARTIST = `(SELECT ar.sort_name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
                        WHERE aa.album_id = a.id ORDER BY aa.position LIMIT 1)`

/** Albums as a discography reads: by year, the undated last, then by title. */
const BY_ALBUM = 'a.year IS NULL, a.year, a.sort_title COLLATE NOCASE'

const LAST_PLAY = `(SELECT MAX(p.played_at) FROM plays p JOIN tracks pt ON pt.media_id = p.media_id
  WHERE p.account_id = @account AND pt.album_id = a.id)`
const PLAY_COUNT = `(SELECT COUNT(*) FROM plays p JOIN tracks pt ON pt.media_id = p.media_id
  WHERE p.account_id = @account AND pt.album_id = a.id)`
const RELEASE_DATE = 'COALESCE(a.release_date, CAST(a.year AS TEXT))'

const ALBUM_FIELDS = {
  [MUSIC_SORTS.title]: 'a.sort_title COLLATE NOCASE',
  [MUSIC_SORTS.artist]: `${FIRST_ARTIST} COLLATE NOCASE`,
  [MUSIC_SORTS.year]: 'a.year',
  [MUSIC_SORTS.added]: 'a.added_at',
  [MUSIC_SORTS.release]: RELEASE_DATE,
  [MUSIC_SORTS.played]: LAST_PLAY,
  [MUSIC_SORTS.plays]: PLAY_COUNT,
  [MUSIC_SORTS.random]: '((a.id * (1103515245 + @seed * 2)) % 2147483647)',
} as const satisfies Record<MusicSort, string>

const ALBUM_ORDER: Record<MusicSort, string> = {
  [MUSIC_SORTS.title]: 'a.sort_title COLLATE NOCASE, a.id',
  [MUSIC_SORTS.artist]: `${FIRST_ARTIST} COLLATE NOCASE, ${BY_ALBUM}, a.id`,
  [MUSIC_SORTS.year]: `${BY_ALBUM}, a.id`,
  [MUSIC_SORTS.added]: 'a.added_at DESC, a.id DESC',
  [MUSIC_SORTS.release]: `${RELEASE_DATE} IS NULL, ${RELEASE_DATE} DESC, a.id`,
  [MUSIC_SORTS.played]: `${LAST_PLAY} IS NULL, ${LAST_PLAY} DESC, a.id`,
  [MUSIC_SORTS.plays]: `${PLAY_COUNT} DESC, a.id`,
  [MUSIC_SORTS.random]: `${ALBUM_FIELDS[MUSIC_SORTS.random]}, a.id`,
}

type AlbumOrderOfProps = Pick<MusicListParams, 'sort' | 'order'>

const albumOrderOf = ({ sort, order }: AlbumOrderOfProps): string => {
  if (order === undefined) return ALBUM_ORDER[sort]
  const field = ALBUM_FIELDS[sort]
  const direction = order === SORT_DIRECTIONS.ascending ? 'ASC' : 'DESC'
  const tieBreak = sort === MUSIC_SORTS.artist ? BY_ALBUM : 'a.sort_title COLLATE NOCASE'
  return `${field} IS NULL, ${field} ${direction}, ${tieBreak}, a.id`
}

/** Where an album's or a track's search looks: the title, and the names of its artists. */
const ALBUM_SEARCH = `(a.title LIKE @pattern ESCAPE '\\' OR EXISTS (
                         SELECT 1 FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
                          WHERE aa.album_id = a.id AND ar.name LIKE @pattern ESCAPE '\\'))`

type TrackOrderOfProps = AlbumOrderOfProps & Pick<MusicListParams, 'byAlbum'>

/**
 * Each track's place in a random listing, the albums' hash over the track's own id, so a
 * shuffle of the library draws its tracks from every album rather than an album at a time.
 */
const TRACK_RANDOM = '((m.id * (1103515245 + @seed * 2)) % 2147483647)'

const trackOrderOf = ({ sort, order, byAlbum = false }: TrackOrderOfProps): string => {
  const direction = order === SORT_DIRECTIONS.descending ? 'DESC' : 'ASC'
  if (!byAlbum && sort === MUSIC_SORTS.random) return `${TRACK_RANDOM}, m.id`
  if (!byAlbum && sort === MUSIC_SORTS.title) return `t.title COLLATE NOCASE ${direction}, m.id`
  if (!byAlbum && sort === MUSIC_SORTS.added) {
    const addedDirection = order === SORT_DIRECTIONS.ascending ? 'ASC' : 'DESC'
    return `m.added_at ${addedDirection}, m.id`
  }
  return `${albumOrderOf({ sort, order })}, t.disc, t.number IS NULL, t.number, t.title COLLATE NOCASE, m.id`
}

const TRACK_SEARCH = `(t.title LIKE @pattern ESCAPE '\\' OR a.title LIKE @pattern ESCAPE '\\'
                       OR EXISTS (
                         SELECT 1 FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id
                          WHERE ta.media_id = m.id AND ar.name LIKE @pattern ESCAPE '\\'))`

type MusicRepositoryAlbumOfReleaseProps = { libraryId: number; mbid: string | null }

type MusicRepositoryArtistsProps = {
  ids: readonly number[]
  /** Libraries whose albums and tracks the counts leave out. */
  hidden: readonly number[]
}

type MusicRepositoryRecordProps = {
  mediaId: number
  libraryId: number
  path: string
  tags: AudioTags
  format: AudioFormat
  /** A cover found in the file's folder, for an album with none whose file embeds none. */
  folderCover: string | null
  coverStamp?: string
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

type MusicRepositoryRecreditAlbumProps = { id: number; filing: Filing; path: string }

type MusicRepositoryListArtistsProps = { libraryId: number } & Pick<MusicListParams, 'search'>

type MusicRepositoryListAlbumsProps = { libraryId: number } & ByAccount &
  Pick<MusicListParams, 'search' | 'sort' | 'order' | 'seed'>

type MusicRepositoryListTracksProps = { libraryId: number } & ByAccount & MusicListParams

type MusicRepositoryArtistProps = {
  id: number
  /** Whether the caller sees a library, so a locked one's albums stay out of the page. */
  seesLibrary: (libraryId: number) => boolean
}

/** An album's page as the music tables alone know it; whether it is a favourite is the account's. */
type AlbumPage = Omit<AlbumDetails, 'isFavourite'>

/** An artist's page as the music tables alone know it; whether they are a favourite is the account's. */
type ArtistPage = Omit<ArtistDetails, 'isFavourite'>

/** An album row's id. */
type AlbumId = { id: number }

/** A page of tracks, and how many there are in all. */
type TrackPage = {
  tracks: Track[]
  total: number
}

/**
 * The music tables: what a scan writes of each audio file's tags, and the
 * artists, albums and tracks the clients list. Every album reads as an
 * `AlbumSummary`, which has no path; what the server needs of a file itself
 * stays `MediaIndex`'s.
 */
@Injectable()
export class MusicRepository implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PictureVersions) private readonly pictureVersions: PictureVersions,
  ) {}

  onModuleInit(): void {
    reconcileAlbums({ db: this.db })
  }

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
      releaseDate: row.release_date,
      type: isAlbumType(row.type) ? row.type : ALBUM_TYPES.album,
      artists: creditsOf(row.artists),
      isCompilation: row.is_compilation === 1,
      trackCount: row.track_count,
      duration: row.duration ?? 0,
      coverVersion: this.pictureVersions.album({
        id: row.id,
        cover: coverOf({
          source: row.cover_source,
          ref: row.cover_ref,
          mbid: row.mbid,
          stamp: row.cover_stamp,
        }),
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
      album: {
        title: row.album_title,
        coverVersion: this.pictureVersions.album({
          id: row.album_id,
          cover: coverOf({
            source: row.album_cover_source,
            ref: row.album_cover_ref,
            stamp: row.album_cover_stamp,
            mbid: row.album_mbid,
          }),
        }),
      },
      gain: {
        track: row.track_gain,
        album: row.album_gain,
        trackPeak: row.track_peak,
        albumPeak: row.album_peak,
      },
    }
  }

  private toArtist(row: ArtistRow): Artist {
    return {
      id: row.id,
      name: row.name,
      sortName: row.sort_name,
      mbid: row.mbid,
      photoVersion: this.pictureVersions.artist({ id: row.id, mbid: row.mbid }),
      albumCount: row.album_count,
      trackCount: row.track_count,
    }
  }

  /** The album already filed under a MusicBrainz release, unless the owner matched it by hand: a file of that release joins it, from whichever folder. */
  private albumOfRelease({
    libraryId,
    mbid,
  }: MusicRepositoryAlbumOfReleaseProps): AlbumId | undefined {
    if (mbid === null) return undefined
    return this.db
      .prepare<[number, string, string], { id: number }>(
        `SELECT id FROM albums WHERE library_id = ? AND mbid = ? AND match <> ? ORDER BY added_at, id LIMIT 1`,
      )
      .get(libraryId, mbid, MATCH_STATES.manual)
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
        `INSERT INTO albums (library_id, album_key, title, sort_title, year, release_date, original_year, mbid,
                             release_group_mbid, type, label, genres, is_compilation, credited_by_tags,
                             cover_source, cover_ref, cover_stamp, replaygain_gain, replaygain_peak,
                             replaygain_source, added_at, match, matched_at)
         VALUES (@libraryId, @key, @title, @sortTitle, @year, @releaseDate, @originalYear, @mbid,
                 @releaseGroupMbid, @type, @label, @genres, @isCompilation, @isCredited,
                 @coverSource, @coverRef, @coverStamp, @gain, @peak, @source, @addedAt, @match, @matchedAt)`,
      )
      .run({
        libraryId,
        key: filing.albumKey,
        title: filing.albumTitle,
        sortTitle: sortTitle(filing.albumTitle),
        releaseDate: tags.releaseDate,
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
        coverStamp: cover?.stamp ?? '',
        gain: tags.replayGain.albumGain,
        peak: tags.replayGain.albumPeak,
        source: tags.replayGain.albumGain === null ? null : REPLAYGAIN_SOURCES.tags,
        addedAt: at.toISOString(),
        // A release id in the tags is a match already; MusicBrainz is asked for the rest.
        match: tags.releaseMbid === null ? MATCH_STATES.pending : MATCH_STATES.matched,
        matchedAt: tags.releaseMbid === null ? null : at.toISOString(),
      })
    const id = Number(inserted.lastInsertRowid)
    creditArtists({
      db: this.db,
      credits: CREDITS.album,
      ownerId: id,
      artists: filing.albumArtists,
    })
    return id
  }

  /** A later file fills in what the album did not know, its ids and its cover above all, and never overwrites what it did. */
  private fillAlbum({ id, tags, cover }: MusicRepositoryFillAlbumProps): void {
    this.db
      .prepare(
        `UPDATE albums
            SET year = COALESCE(year, @year), original_year = COALESCE(original_year, @originalYear),
                release_date = CASE WHEN release_date IS NULL OR
                  (substr(release_date, 1, 4) = substr(@releaseDate, 1, 4) AND length(@releaseDate) > length(release_date))
                  THEN COALESCE(@releaseDate, release_date) ELSE release_date END,
                match = CASE WHEN mbid IS NULL AND @mbid IS NOT NULL AND match <> @manual
                             THEN @matched ELSE match END,
                matched_at = CASE WHEN mbid IS NULL AND @mbid IS NOT NULL AND match <> @manual
                                  THEN @at ELSE matched_at END,
                mbid = CASE WHEN match = @manual THEN mbid ELSE COALESCE(mbid, @mbid) END,
                release_group_mbid = CASE WHEN match = @manual THEN release_group_mbid
                                          ELSE COALESCE(release_group_mbid, @releaseGroupMbid) END,
                label = COALESCE(label, @label),
                genres = CASE WHEN genres = '[]' THEN @genres ELSE genres END,
                cover_stamp = CASE WHEN cover_source IS NULL OR (cover_source = @coverSource AND cover_ref = @coverRef)
                                    OR (cover_source = 'embedded' AND @coverSource = 'file')
                                   THEN @coverStamp ELSE cover_stamp END,
                cover_ref = CASE WHEN cover_source IS NULL OR (cover_source = 'embedded' AND @coverSource = 'file')
                                 THEN @coverRef ELSE cover_ref END,
                cover_source = CASE WHEN cover_source = 'embedded' AND @coverSource = 'file'
                                    THEN @coverSource ELSE COALESCE(cover_source, @coverSource) END,
                replaygain_gain = CASE WHEN replaygain_source IS NOT @tags AND @gain IS NOT NULL
                                       THEN @gain ELSE replaygain_gain END,
                replaygain_peak = CASE WHEN replaygain_source IS NOT @tags AND @gain IS NOT NULL
                                       THEN @peak ELSE COALESCE(replaygain_peak, @peak) END,
                replaygain_source = CASE WHEN @gain IS NOT NULL THEN @tags
                                         ELSE replaygain_source END
          WHERE id = @id`,
      )
      .run({
        id,
        releaseDate: tags.releaseDate,
        year: tags.year,
        originalYear: tags.originalYear,
        mbid: tags.releaseMbid,
        releaseGroupMbid: tags.releaseGroupMbid,
        label: tags.label,
        genres: JSON.stringify(tags.genres),
        coverSource: cover?.source ?? null,
        coverRef: cover?.ref ?? null,
        coverStamp: cover?.stamp ?? '',
        gain: tags.replayGain.albumGain,
        peak: tags.replayGain.albumPeak,
        tags: REPLAYGAIN_SOURCES.tags,
        matched: MATCH_STATES.matched,
        manual: MATCH_STATES.manual,
        at: new Date().toISOString(),
      })
  }

  /** Prefer explicit album credits, then a stable file path, independent of scan completion order. */
  private recreditAlbum({ id, filing, path }: MusicRepositoryRecreditAlbumProps): void {
    const changed = this.db
      .prepare(`UPDATE albums SET credited_by_tags = @credited, metadata_path = @path,
                  title = @title, sort_title = @sortTitle
                WHERE id = @id AND (metadata_path IS NULL OR credited_by_tags < @credited
                  OR (credited_by_tags = @credited AND metadata_path >= @path))`)
      .run({
        id,
        path,
        credited: filing.isAlbumCredited ? 1 : 0,
        title: filing.albumTitle,
        sortTitle: sortTitle(filing.albumTitle),
      })
    if (changed.changes === 0) return
    creditArtists({
      db: this.db,
      credits: CREDITS.album,
      ownerId: id,
      artists: filing.albumArtists,
    })
  }

  /**
   * Files one audio file under its album and artists from what its tags
   * say, in one write. A file read again (replaced, or on a full scan)
   * stays in its folder's album; an album it leaves empty goes at the next
   * `prune`, which the scan runs once its files are read.
   */
  record({
    mediaId,
    libraryId,
    path,
    tags,
    format,
    folderCover,
    coverStamp = '',
    at = new Date(),
  }: MusicRepositoryRecordProps): void {
    const filing = filingOf({ tags, path })
    const folderAlbumCover: AlbumCover | null =
      folderCover === null ? null : { source: COVER_SOURCES.file, ref: folderCover }
    const embeddedCover: AlbumCover | null = tags.hasCover
      ? { source: COVER_SOURCES.embedded, ref: String(mediaId), stamp: coverStamp }
      : null
    const cover =
      folderAlbumCover === null ? embeddedCover : { ...folderAlbumCover, stamp: coverStamp }
    this.db.transaction(() => {
      const previous = this.db
        .prepare<[number], { id: number; album_key: string; match: string; mbid: string | null }>(
          'SELECT a.id, a.album_key, a.match, a.mbid FROM albums a JOIN tracks t ON t.album_id = a.id WHERE t.media_id = ?',
        )
        .get(mediaId)
      if (
        previous !== undefined &&
        previous.match === MATCH_STATES.manual &&
        previous.album_key !== filing.albumKey
      ) {
        const manual = this.db
          .prepare<[number], { id: number; path: string; mbid: string | null }>(
            `SELECT a.id, m.path, a.mbid FROM albums a JOIN tracks t ON t.album_id = a.id
           JOIN media m ON m.id = t.media_id WHERE a.library_id = ? AND a.match = '${MATCH_STATES.manual}'`,
          )
          .all(libraryId)
        const conflict = manual.find(
          (album) =>
            albumFolderOf(album.path) === albumFolderOf(path) && album.mbid !== previous.mbid,
        )
        if (conflict)
          throw new Error(
            `Resolve conflicting manual matches for albums ${previous.id} and ${conflict.id} before merging`,
          )
      }
      const existing =
        this.db
          .prepare<[number, string], { id: number }>(
            'SELECT id FROM albums WHERE library_id = ? AND album_key = ?',
          )
          .get(libraryId, filing.albumKey) ??
        this.albumOfRelease({ libraryId, mbid: tags.releaseMbid })
      const albumId = existing?.id ?? this.insertAlbum({ libraryId, filing, tags, cover, at })
      const conflicting = this.db
        .prepare<[number, number], { id: number }>(
          `SELECT old.id FROM tracks t JOIN albums old ON old.id = t.album_id JOIN albums target ON target.id = ?
          WHERE t.media_id = ? AND old.id <> target.id AND old.match = '${MATCH_STATES.manual}'
            AND target.match = '${MATCH_STATES.manual}' AND old.mbid IS NOT target.mbid`,
        )
        .get(albumId, mediaId)
      if (conflicting)
        throw new Error(
          `Resolve conflicting manual matches for albums ${conflicting.id} and ${albumId} before merging`,
        )
      if (existing) {
        this.fillAlbum({ id: albumId, tags, cover })
      }
      this.recreditAlbum({ id: albumId, filing, path })
      this.db
        .prepare(
          `INSERT OR REPLACE INTO tracks (media_id, album_id, disc, number, title, mbid, isrc, sample_rate,
                                          bit_depth, is_lossless, replaygain_gain, replaygain_peak,
                                          replaygain_source)
           VALUES (@mediaId, @albumId, @disc, @number, @title, @mbid, @isrc, @sampleRate,
                   @bitDepth, @isLossless, @gain, @peak, @source)`,
        )
        .run({
          mediaId,
          albumId,
          disc: tags.disc ?? discOfPath(path),
          number: tags.trackNumber,
          title: filing.trackTitle,
          mbid: tags.recordingMbid,
          isrc: tags.isrc,
          sampleRate: format.sampleRate,
          bitDepth: format.bitDepth,
          isLossless: format.isLossless ? 1 : 0,
          gain: tags.replayGain.trackGain,
          peak: tags.replayGain.trackPeak,
          source: tags.replayGain.trackGain === null ? null : REPLAYGAIN_SOURCES.tags,
        })
      creditArtists({
        db: this.db,
        credits: CREDITS.track,
        ownerId: mediaId,
        artists: filing.trackArtists,
      })
    })()
  }

  /**
   * Drops the albums with no track left and the artists credited on
   * nothing, and lets an album whose cover was in a file now gone take one
   * from the next file read. It runs once a scan's files are read and after
   * every removal of media, whatever kind of files went.
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

  /** The library an album is in, or null when there is no such album. */
  libraryOfAlbum(id: number): number | null {
    return (
      this.db
        .prepare<[number], { library_id: number }>('SELECT library_id FROM albums WHERE id = ?')
        .get(id)?.library_id ?? null
    )
  }

  /** The album each of these files is a track of, by file id, with its cover's version; a file that is no track is left out. */
  albumsOfMedia(mediaIds: readonly number[]): Map<number, MediaAlbum> {
    if (mediaIds.length === 0) return new Map()
    return new Map(
      this.db
        .prepare<[string], CoverOfProps & { media_id: number; id: number; title: string }>(
          `SELECT t.media_id, a.id, a.title, a.cover_source AS source, a.cover_ref AS ref,
                  a.cover_stamp AS stamp, a.mbid
             FROM tracks t JOIN albums a ON a.id = t.album_id
            WHERE t.media_id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(mediaIds))
        .map((row) => [
          row.media_id,
          {
            id: row.id,
            title: row.title,
            coverVersion: this.pictureVersions.album({ id: row.id, cover: coverOf(row) }),
          },
        ]),
    )
  }

  /** A library's artists, by name, each with how many of that library's albums and tracks credit them. */
  listArtists({ libraryId, search }: MusicRepositoryListArtistsProps): Artist[] {
    return this.db
      .prepare<{ libraryId: number; pattern: string }, ArtistRow>(
        `WITH album_counts AS (
           SELECT aa.artist_id, COUNT(*) AS count FROM albums a
           JOIN album_artists aa ON aa.album_id = a.id
           WHERE a.library_id = @libraryId GROUP BY aa.artist_id
         ), track_counts AS (
           SELECT ta.artist_id, COUNT(*) AS count FROM media m
           JOIN track_artists ta ON ta.media_id = m.id
           WHERE m.library_id = @libraryId GROUP BY ta.artist_id
         ), credited AS (
           SELECT artist_id FROM album_counts UNION SELECT artist_id FROM track_counts
         )
         SELECT ar.id, ar.name, ar.sort_name, ar.mbid,
                COALESCE(ac.count, 0) AS album_count, COALESCE(tc.count, 0) AS track_count
           FROM credited JOIN artists ar ON ar.id = credited.artist_id
           LEFT JOIN album_counts ac ON ac.artist_id = ar.id
           LEFT JOIN track_counts tc ON tc.artist_id = ar.id
          WHERE ar.name LIKE @pattern ESCAPE '\\'
          ORDER BY ar.sort_name COLLATE NOCASE, ar.id`,
      )
      .all({ libraryId, pattern: likePattern(search.trim()) })
      .map((row) => this.toArtist(row))
  }

  /** A library's albums in `sort` order; search matches the title and the artists' names. */
  listAlbums({
    libraryId,
    search,
    sort,
    order,
    seed = 0,
    account,
  }: MusicRepositoryListAlbumsProps): AlbumSummary[] {
    return this.db
      .prepare<{ libraryId: number; pattern: string; seed: number; account: string }, AlbumRow>(
        `${SELECT_ALBUMS}
          WHERE a.library_id = @libraryId AND ${ALBUM_SEARCH}
          GROUP BY a.id
          ORDER BY ${albumOrderOf({ sort, order })}`,
      )
      .all({ libraryId, pattern: likePattern(search.trim()), seed, account })
      .map((row) => this.toAlbum(row))
  }

  /** One page of a library's tracks in `sort` order, and how many the listing holds in all. */
  listTracks({
    libraryId,
    search,
    sort,
    order,
    seed = 0,
    account,
    limit,
    offset,
    byAlbum,
  }: MusicRepositoryListTracksProps): TrackPage {
    const params = { libraryId, pattern: likePattern(search.trim()), limit, offset, seed, account }
    const tracks = this.db
      .prepare<typeof params, TrackRow>(
        `${SELECT_TRACKS}
          WHERE m.library_id = @libraryId AND ${TRACK_SEARCH}
          ORDER BY ${trackOrderOf({ sort, order, byAlbum })}
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

  /** The tracks among `ids`, by id; an id that is no track is not in the map. */
  tracks(ids: readonly number[]): Map<number, Track> {
    const tracks = this.db
      .prepare<[string], TrackRow>(
        `${SELECT_TRACKS} WHERE t.media_id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify([...new Set(ids)]))
      .map((row) => this.toTrack(row))
    return new Map(tracks.map((track) => [track.id, track]))
  }

  /** The tracks among `ids` in the order `ids` lists them; an id that is no track is left out. */
  tracksInOrder(ids: readonly number[]): Track[] {
    const byId = this.tracks(ids)
    return ids.flatMap((id) => byId.get(id) ?? [])
  }

  /** The albums among `ids` in the order `ids` lists them; an id that is no album is left out. */
  albumsInOrder(ids: readonly number[]): AlbumSummary[] {
    const byId = this.albums(ids)
    return ids.flatMap((id) => byId.get(id) ?? [])
  }

  /** The albums among `ids`, by id; an id that is no album is not in the map. */
  albums(ids: readonly number[]): Map<number, AlbumSummary> {
    const albums = this.db
      .prepare<[string], AlbumRow>(
        `${SELECT_ALBUMS} WHERE a.id IN (SELECT value FROM json_each(?)) GROUP BY a.id`,
      )
      .all(JSON.stringify([...new Set(ids)]))
      .map((row) => this.toAlbum(row))
    return new Map(albums.map((album) => [album.id, album]))
  }

  /**
   * The artists among `ids`, by id, each counted over the albums and
   * tracks outside `hidden`; one credited on nothing else counts 0 and 0.
   */
  artists({ ids, hidden }: MusicRepositoryArtistsProps): Map<number, Artist> {
    const artists = this.db
      .prepare<{ ids: string; hidden: string }, ArtistRow>(
        `SELECT ar.id, ar.name, ar.sort_name, ar.mbid,
                (SELECT COUNT(*) FROM album_artists aa JOIN albums a ON a.id = aa.album_id
                  WHERE aa.artist_id = ar.id
                    AND a.library_id NOT IN (SELECT value FROM json_each(@hidden))) AS album_count,
                (SELECT COUNT(*) FROM track_artists ta JOIN media m ON m.id = ta.media_id
                  WHERE ta.artist_id = ar.id
                    AND m.library_id NOT IN (SELECT value FROM json_each(@hidden))) AS track_count
           FROM artists ar
          WHERE ar.id IN (SELECT value FROM json_each(@ids))`,
      )
      .all({ ids: JSON.stringify([...new Set(ids)]), hidden: JSON.stringify(hidden) })
      .map((row) => this.toArtist(row))
    return new Map(artists.map((artist) => [artist.id, artist]))
  }

  /** An album with its tracks in disc and number order, or null when there is no such album. */
  album(id: number): AlbumPage | null {
    const row = this.db
      .prepare<[number], AlbumDetailsRow>(`${SELECT_ALBUM_DETAILS} WHERE a.id = ? GROUP BY a.id`)
      .get(id)
    if (!row) return null
    const tracks = this.db
      .prepare<[number], TrackRow>(
        `${SELECT_TRACKS} WHERE t.album_id = ? AND ${SHOWN_TRACK}
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
  artist({ id, seesLibrary }: MusicRepositoryArtistProps): ArtistPage | null {
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
