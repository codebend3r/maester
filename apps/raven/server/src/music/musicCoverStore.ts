import { Inject, Injectable } from '@nestjs/common'
import { sameSecret } from '@shared/server'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { PictureVersions } from '@/metadata/pictureVersions'

/** Where an album's cover comes from: a picture embedded in one of its files, a file in its folder, or the Cover Art Archive. */
export const COVER_SOURCES = { embedded: 'embedded', file: 'file', coverArtArchive: 'caa' } as const

/** An album's cover: the media id of the file that embeds it, the path of the picture in its folder, or the release id the archive files it under. */
export type AlbumCover = {
  source: (typeof COVER_SOURCES)[keyof typeof COVER_SOURCES]
  ref: string
  stamp?: string
}

const isCoverSource = (value: unknown): value is AlbumCover['source'] =>
  Object.values(COVER_SOURCES).some((source) => source === value)

export type CoverOfProps = {
  source: string | null
  ref: string | null
  mbid: string | null
  stamp?: string
}

/**
 * An album's cover: the one its files or folder gave it, else the Cover
 * Art Archive's by its release id, which is never stored as a cover so a
 * picture that turns up beside the files later still wins.
 */
export const coverOf = ({ source, ref, mbid, stamp = '' }: CoverOfProps): AlbumCover | null => {
  if (isCoverSource(source) && ref != null) return { source, ref, ...(stamp ? { stamp } : {}) }
  return mbid === null ? null : { source: COVER_SOURCES.coverArtArchive, ref: mbid }
}

type ArtistPictureRow = { mbid: string | null; picture: string | null; fetched_at: string | null }

/** Where an artist's picture comes from: their MusicBrainz id, and the picture found for it, once looked for. */
type ArtistPicture = { mbid: string; picture: string | null; isFetched: boolean }

/** Every album's id, and every release id an album shows the archive's cover of. */
type KeptCovers = { albumIds: Set<number>; coverArtIds: Set<string> }

/** An album with a cover, and the version its address carries. */
type CoverVersion = { id: number; version: string }

/** A file of an album, which may embed its cover. */
type CoverFile = { id: number; path: string }

type MusicCoverStoreCoverProps = { id: number; version: string }
type MusicCoverStoreSetCoverProps = { id: number; cover: AlbumCover }
type MusicCoverStoreSetArtistPictureProps = { id: number; picture: string | null }
type MusicCoverStoreArtistPictureProps = { id: number; version: string }

/** The music tables' pictures: where each album's cover and each artist's picture is read from, and the versions that address them. */
@Injectable()
export class MusicCoverStore {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PictureVersions) private readonly pictureVersions: PictureVersions,
  ) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  setArtistPicture({ id, picture }: MusicCoverStoreSetArtistPictureProps): void {
    this.db
      .prepare('UPDATE artists SET picture = ?, fetched_at = ? WHERE id = ?')
      .run(picture, new Date().toISOString(), id)
  }

  artistPicture({ id, version }: MusicCoverStoreArtistPictureProps): ArtistPicture | null {
    const row = this.db
      .prepare<[number], ArtistPictureRow>(
        'SELECT mbid, picture, fetched_at FROM artists WHERE id = ?',
      )
      .get(id)
    if (row === undefined || row.mbid === null) return null
    const current = this.pictureVersions.artist({ id, mbid: row.mbid })
    return current !== null && sameSecret({ given: version, expected: current })
      ? { mbid: row.mbid, picture: row.picture, isFetched: row.fetched_at !== null }
      : null
  }

  /** Every album's id, and every release id an album shows the archive's cover of, for the image cache's sweep. */
  keptCovers(): KeptCovers {
    const rows = this.db
      .prepare<[], { id: number; mbid: string | null; group: string | null }>(
        'SELECT id, mbid, release_group_mbid AS "group" FROM albums',
      )
      .all()
    return {
      albumIds: new Set(rows.map((row) => row.id)),
      coverArtIds: new Set(
        rows.flatMap((row) =>
          [row.mbid, row.group].flatMap((mbid) => (mbid === null ? [] : [mbid])),
        ),
      ),
    }
  }

  /** The release group an album's release belongs to, which the archive files a cover under when the release has none. */
  releaseGroupOf(id: number): string | null {
    return (
      this.db
        .prepare<[number], { group: string | null }>(
          'SELECT release_group_mbid AS "group" FROM albums WHERE id = ?',
        )
        .get(id)?.group ?? null
    )
  }

  /**
   * Where an album's cover is read from, when `version` is its current
   * one: the file that embeds it, or the picture in its folder. Null for
   * another version, or an album with no cover.
   */
  cover({ id, version }: MusicCoverStoreCoverProps): AlbumCover | null {
    const row = this.db
      .prepare<[number], CoverOfProps>(
        'SELECT cover_source AS source, cover_ref AS ref, cover_stamp AS stamp, mbid FROM albums WHERE id = ?',
      )
      .get(id)
    const cover = row === undefined ? null : coverOf(row)
    return cover !== null && this.pictureVersions.album({ id, cover }) === version ? cover : null
  }

  /** Every album that has a cover to show, with the version its address carries, for covers made ahead of a request. */
  coverVersions(): CoverVersion[] {
    return this.db
      .prepare<[], CoverOfProps & { id: number }>(
        'SELECT id, cover_source AS source, cover_ref AS ref, cover_stamp AS stamp, mbid FROM albums ORDER BY id',
      )
      .all()
      .flatMap((row) => {
        const cover = coverOf(row)
        const version = cover === null ? null : this.pictureVersions.album({ id: row.id, cover })
        return version === null ? [] : [{ id: row.id, version }]
      })
  }

  coverFiles(id: number): CoverFile[] {
    return this.db
      .prepare<[number], { id: number; path: string }>(
        'SELECT m.id, m.path FROM tracks t JOIN media m ON m.id = t.media_id WHERE t.album_id = ? ORDER BY m.path',
      )
      .all(id)
  }

  setCover({ id, cover }: MusicCoverStoreSetCoverProps): void {
    this.db
      .prepare('UPDATE albums SET cover_source = ?, cover_ref = ?, cover_stamp = ? WHERE id = ?')
      .run(cover.source, cover.ref, cover.stamp ?? '', id)
  }
}
