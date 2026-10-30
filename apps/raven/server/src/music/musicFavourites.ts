import { Inject, Injectable } from '@nestjs/common'
import type { AlbumSummary, Artist } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FAVOURITE_OUTCOMES, type FavouriteOutcome } from '@/media/favouriteOutcomes'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'
import { MusicRepository } from '@/music/musicRepository'

/** The two music favourite tables, each keyed by the account and the id of what it marks. */
const FAVOURITE_TABLES = {
  album: { table: 'album_favourites', key: 'album_id' },
  artist: { table: 'artist_favourites', key: 'artist_id' },
} as const

type FavouriteTable = (typeof FAVOURITE_TABLES)[keyof typeof FAVOURITE_TABLES]

/** Whether an artist counted over some libraries is credited on anything in them. */
const isCredited = (artist: Artist | undefined): artist is Artist =>
  artist !== undefined && artist.albumCount + artist.trackCount > 0

type MusicFavouritesIsMarkedProps = { of: FavouriteTable; id: number; account: AccountKey }

type MusicFavouritesMarkProps = {
  of: FavouriteTable
  id: number
  favourite: boolean
  account: AccountKey
  /** Whether a library that is not locked holds it, asked only when marking. */
  isOpen: () => boolean
}

type MusicFavouritesMarkedIdsProps = { of: FavouriteTable; account: AccountKey }

type MusicFavouritesIsAlbumProps = { albumId: number; account: AccountKey }

type MusicFavouritesIsArtistProps = { artistId: number; account: AccountKey }

type MusicFavouritesSetAlbumProps = { albumId: number; favourite: boolean; account: AccountKey }

type MusicFavouritesSetArtistProps = { artistId: number; favourite: boolean; account: AccountKey }

type MusicFavouritesAlbumsProps = { account: AccountKey }

type MusicFavouritesArtistsProps = { account: AccountKey }

/**
 * The albums and artists each account marked as favourites, in two small
 * tables keyed by account rather than a kind column on `item_favourites`,
 * whose ids are TMDB items: an album or artist row cascades away with what
 * it names, as a title's does. As with the titles, a locked library's are
 * left out whether or not the PIN is entered: an album in one can never be
 * marked, nor an artist credited only in locked libraries, and neither is
 * listed.
 */
@Injectable()
export class MusicFavourites {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  private isMarked({ of, id, account }: MusicFavouritesIsMarkedProps): boolean {
    return !!this.db
      .prepare<[ByAccount, number], Record<string, number>>(
        `SELECT ${of.key} FROM ${of.table} WHERE account_id = @account AND ${of.key} = ?`,
      )
      .get({ account }, id)
  }

  /**
   * Marking again keeps the first time, so the list does not reshuffle;
   * unmarking always goes through, so a favourite left in a library locked
   * since can still be cleared.
   */
  private mark({ of, id, favourite, account, isOpen }: MusicFavouritesMarkProps): FavouriteOutcome {
    if (!favourite) {
      this.db
        .prepare(`DELETE FROM ${of.table} WHERE account_id = @account AND ${of.key} = ?`)
        .run({ account }, id)
      return FAVOURITE_OUTCOMES.done
    }
    if (!isOpen()) return FAVOURITE_OUTCOMES.locked
    this.db
      .prepare(
        `INSERT INTO ${of.table} (account_id, ${of.key}, added_at) VALUES (@account, ?, ?)
         ON CONFLICT (account_id, ${of.key}) DO NOTHING`,
      )
      .run({ account }, id, new Date().toISOString())
    return FAVOURITE_OUTCOMES.done
  }

  /** The ids `account` marked, most recently marked first. */
  private markedIds({ of, account }: MusicFavouritesMarkedIdsProps): number[] {
    return this.db
      .prepare<ByAccount, { id: number }>(
        `SELECT ${of.key} AS id FROM ${of.table} WHERE account_id = @account
          ORDER BY added_at DESC, ${of.key} DESC`,
      )
      .all({ account })
      .map((row) => row.id)
  }

  isAlbum({ albumId, account }: MusicFavouritesIsAlbumProps): boolean {
    return this.isMarked({ of: FAVOURITE_TABLES.album, id: albumId, account })
  }

  isArtist({ artistId, account }: MusicFavouritesIsArtistProps): boolean {
    return this.isMarked({ of: FAVOURITE_TABLES.artist, id: artistId, account })
  }

  /** Marks or unmarks an album, which is locked away with its library. */
  setAlbum({ albumId, favourite, account }: MusicFavouritesSetAlbumProps): FavouriteOutcome {
    return this.db.transaction(() => {
      const libraryId = this.music.libraryOfAlbum(albumId)
      if (libraryId === null) return FAVOURITE_OUTCOMES.missing
      return this.mark({
        of: FAVOURITE_TABLES.album,
        id: albumId,
        favourite,
        account,
        isOpen: () => !this.libraries.lockedIds().has(libraryId),
      })
    })()
  }

  /** Marks or unmarks an artist, who is locked away when only locked libraries credit them. */
  setArtist({ artistId, favourite, account }: MusicFavouritesSetArtistProps): FavouriteOutcome {
    return this.db.transaction(() => {
      if (!this.music.artists({ ids: [artistId], hidden: [] }).has(artistId)) {
        return FAVOURITE_OUTCOMES.missing
      }
      return this.mark({
        of: FAVOURITE_TABLES.artist,
        id: artistId,
        favourite,
        account,
        isOpen: () =>
          isCredited(
            this.music
              .artists({ ids: [artistId], hidden: [...this.libraries.lockedIds()] })
              .get(artistId),
          ),
      })
    })()
  }

  /** Every album `account` favoured that a library that is not locked holds, most recently marked first. */
  albums({ account }: MusicFavouritesAlbumsProps): AlbumSummary[] {
    const locked = this.libraries.lockedIds()
    const ids = this.markedIds({ of: FAVOURITE_TABLES.album, account })
    const albums = this.music.albums(ids)
    return ids.flatMap((id) => {
      const album = albums.get(id)
      return album === undefined || locked.has(album.libraryId) ? [] : [album]
    })
  }

  /**
   * Every artist `account` favoured that a library that is not locked
   * credits, most recently marked first, counted over those libraries.
   */
  artists({ account }: MusicFavouritesArtistsProps): Artist[] {
    const ids = this.markedIds({ of: FAVOURITE_TABLES.artist, account })
    const artists = this.music.artists({ ids, hidden: [...this.libraries.lockedIds()] })
    return ids.flatMap((id) => {
      const artist = artists.get(id)
      return isCredited(artist) ? [artist] : []
    })
  }
}
