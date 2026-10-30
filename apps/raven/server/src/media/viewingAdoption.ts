import { Inject, Injectable } from '@nestjs/common'
import { DatabaseService } from '@/db/database'
import { VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import { SettingsRepository } from '@/settings/settingsRepository'

/** How many rows from before accounts the owner took over, table by table. */
export type AdoptedCounts = {
  spots: number
  plays: number
  favourites: number
  titleFavourites: number
  albumFavourites: number
  artistFavourites: number
  playlists: number
}

type Adopting = { owner: string; local: typeof VIEWING_ACCOUNTS.local }

/**
 * The favourite tables, by the count each adds to: every one keyed by the
 * account and the id of what it marks, with the time it was marked.
 */
const FAVOURITE_TABLES = {
  favourites: { table: 'favourites', key: 'media_id' },
  titleFavourites: { table: 'item_favourites', key: 'item_id' },
  albumFavourites: { table: 'album_favourites', key: 'album_id' },
  artistFavourites: { table: 'artist_favourites', key: 'artist_id' },
} as const

type FavouriteTable = (typeof FAVOURITE_TABLES)[keyof typeof FAVOURITE_TABLES]

/** Every table that keeps viewing by account, the favourite tables among them. */
const VIEWING_TABLES = [
  'playback_progress',
  'plays',
  ...Object.values(FAVOURITE_TABLES).map(({ table }) => table),
  'playlists',
] as const

type ViewingAdoptionMergeFavouritesProps = { of: FavouriteTable; adopting: Adopting }

type ViewingAdoptionAdoptProps = { ownerId: string }

/**
 * Gives the owner every spot, play, favourite and playlist recorded before accounts,
 * which a migration could only keep under `VIEWING_ACCOUNTS.local`. One
 * transaction merges them into the owner's own rows, so a second run finds
 * nothing and a failure part way leaves everything as it was. Where the
 * owner already has a row for the same video or title, the newer spot and
 * the earlier favourite are kept.
 */
@Injectable()
export class ViewingAdoption {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SettingsRepository)
    private readonly settings: Pick<SettingsRepository, 'markViewingOwner'>,
  ) {}

  private get db() {
    return this.database.db
  }

  /** Whether any spot, play, favourite or playlist is still kept from before accounts. */
  hasLocalRows(): boolean {
    const row = this.db
      .prepare<{ local: string }, { found: number }>(
        `SELECT ${VIEWING_TABLES.map(
          (table) => `EXISTS (SELECT 1 FROM ${table} WHERE account_id = @local)`,
        ).join(' OR ')} AS found`,
      )
      .get({ local: VIEWING_ACCOUNTS.local })
    return (row?.found ?? 0) === 1
  }

  /**
   * Gives the owner `of`'s rows from before accounts, keeping the earlier
   * time where the owner marked the same one too; how many there were.
   */
  private mergeFavourites({
    of: { table, key },
    adopting,
  }: ViewingAdoptionMergeFavouritesProps): number {
    this.db
      .prepare<Adopting>(
        `INSERT INTO ${table} (account_id, ${key}, added_at)
         SELECT @owner, ${key}, added_at FROM ${table} WHERE account_id = @local
         ON CONFLICT (account_id, ${key}) DO UPDATE
           SET added_at = excluded.added_at
           WHERE excluded.added_at < ${table}.added_at`,
      )
      .run(adopting)
    return this.db
      .prepare<Pick<Adopting, 'local'>>(`DELETE FROM ${table} WHERE account_id = @local`)
      .run({ local: adopting.local }).changes
  }

  /** Moves every row from before accounts to `ownerId` and, when any moved, records that owner; counts what moved. */
  adopt({ ownerId }: ViewingAdoptionAdoptProps): AdoptedCounts {
    const adopting: Adopting = { owner: ownerId, local: VIEWING_ACCOUNTS.local }
    const local = { local: VIEWING_ACCOUNTS.local }
    return this.db.transaction((): AdoptedCounts => {
      this.db
        .prepare<Adopting>(
          `INSERT INTO playback_progress (account_id, media_id, position, updated_at)
           SELECT @owner, media_id, position, updated_at FROM playback_progress
            WHERE account_id = @local
           ON CONFLICT (account_id, media_id) DO UPDATE
             SET position = excluded.position, updated_at = excluded.updated_at
             WHERE excluded.updated_at > playback_progress.updated_at`,
        )
        .run(adopting)
      const plays = this.db
        .prepare<Adopting>('UPDATE plays SET account_id = @owner WHERE account_id = @local')
        .run(adopting).changes
      // A playlist is the owner's as it was: no two are the same list, so none merge.
      const playlists = this.db
        .prepare<Adopting>('UPDATE playlists SET account_id = @owner WHERE account_id = @local')
        .run(adopting).changes
      const spots = this.db
        .prepare<typeof local>('DELETE FROM playback_progress WHERE account_id = @local')
        .run(local).changes
      const counts: AdoptedCounts = {
        spots,
        plays,
        favourites: this.mergeFavourites({ of: FAVOURITE_TABLES.favourites, adopting }),
        titleFavourites: this.mergeFavourites({ of: FAVOURITE_TABLES.titleFavourites, adopting }),
        albumFavourites: this.mergeFavourites({ of: FAVOURITE_TABLES.albumFavourites, adopting }),
        artistFavourites: this.mergeFavourites({ of: FAVOURITE_TABLES.artistFavourites, adopting }),
        playlists,
      }
      if (Object.values(counts).every((count) => count === 0)) return counts
      this.settings.markViewingOwner({ ownerId, at: new Date() })
      return counts
    })()
  }
}
