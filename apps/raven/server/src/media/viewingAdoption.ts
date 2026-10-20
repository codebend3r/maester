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
}

type Adopting = { owner: string; local: typeof VIEWING_ACCOUNTS.local }

/**
 * Gives the owner every spot, play and favourite recorded before accounts,
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

  /** Whether any spot, play or favourite is still kept from before accounts. */
  hasLocalRows(): boolean {
    const row = this.db
      .prepare<{ local: string }, { found: number }>(
        `SELECT
           EXISTS (SELECT 1 FROM playback_progress WHERE account_id = @local)
           OR EXISTS (SELECT 1 FROM plays WHERE account_id = @local)
           OR EXISTS (SELECT 1 FROM favourites WHERE account_id = @local)
           OR EXISTS (SELECT 1 FROM item_favourites WHERE account_id = @local) AS found`,
      )
      .get({ local: VIEWING_ACCOUNTS.local })
    return (row?.found ?? 0) === 1
  }

  /** Moves every row from before accounts to `ownerId` and, when any moved, records that owner; counts what moved. */
  adopt({ ownerId }: { ownerId: string }): AdoptedCounts {
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
      this.db
        .prepare<Adopting>(
          `INSERT INTO favourites (account_id, media_id, added_at)
           SELECT @owner, media_id, added_at FROM favourites WHERE account_id = @local
           ON CONFLICT (account_id, media_id) DO UPDATE
             SET added_at = excluded.added_at
             WHERE excluded.added_at < favourites.added_at`,
        )
        .run(adopting)
      this.db
        .prepare<Adopting>(
          `INSERT INTO item_favourites (account_id, item_id, added_at)
           SELECT @owner, item_id, added_at FROM item_favourites WHERE account_id = @local
           ON CONFLICT (account_id, item_id) DO UPDATE
             SET added_at = excluded.added_at
             WHERE excluded.added_at < item_favourites.added_at`,
        )
        .run(adopting)
      const plays = this.db
        .prepare<Adopting>('UPDATE plays SET account_id = @owner WHERE account_id = @local')
        .run(adopting).changes
      const spots = this.db
        .prepare<typeof local>('DELETE FROM playback_progress WHERE account_id = @local')
        .run(local).changes
      const favourites = this.db
        .prepare<typeof local>('DELETE FROM favourites WHERE account_id = @local')
        .run(local).changes
      const titleFavourites = this.db
        .prepare<typeof local>('DELETE FROM item_favourites WHERE account_id = @local')
        .run(local).changes
      const counts = { spots, plays, favourites, titleFavourites }
      if (Object.values(counts).every((count) => count === 0)) return counts
      this.settings.markViewingOwner({ ownerId, at: new Date() })
      return counts
    })()
  }
}
