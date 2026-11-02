import { Inject, Injectable } from '@nestjs/common'
import { BINGE_LIMIT, type BingeState, ITEM_TYPES } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { BINGE_OUTCOMES, type BingeOutcome } from '@/media/bingeOutcomes'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'
import { MetadataRepository } from '@/metadata/metadataRepository'

type BingeShowsStateProps = { account: AccountKey }

type BingeShowsSetProps = { itemId: number; binge: boolean; account: AccountKey }

type BingeShowsDismissTipProps = { account: AccountKey }

/**
 * The shows each account is binging, at most `BINGE_LIMIT`, most recently
 * added first. Only a show a library that is not locked holds can be added;
 * removing always goes through.
 */
@Injectable()
export class BingeShows {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /** `account`'s binge shows and whether it has dismissed the tip. */
  state({ account }: BingeShowsStateProps): BingeState {
    const ids = this.db
      .prepare<ByAccount, { item_id: number }>(
        `SELECT item_id FROM binge_shows WHERE account_id = @account
          ORDER BY added_at DESC, item_id DESC`,
      )
      .all({ account })
      .map((row) => row.item_id)
    const hasSeenTip = !!this.db
      .prepare<ByAccount, { account_id: string }>(
        'SELECT account_id FROM binge_tips WHERE account_id = @account',
      )
      .get({ account })
    return { ids, hasSeenTip }
  }

  /**
   * Adding a show already on the list keeps its place. Adding one dismisses
   * the tip too, as marking a first show answers it.
   */
  set({ itemId, binge, account }: BingeShowsSetProps): BingeOutcome {
    return this.db.transaction((): BingeOutcome => {
      if (!binge) {
        this.db
          .prepare('DELETE FROM binge_shows WHERE account_id = @account AND item_id = ?')
          .run({ account }, itemId)
        return BINGE_OUTCOMES.done
      }
      if (this.metadata.get(itemId)?.type !== ITEM_TYPES.show) return BINGE_OUTCOMES.missing
      const locked = this.libraries.lockedIds()
      if (!this.metadata.librariesHolding(itemId).some((libraryId) => !locked.has(libraryId))) {
        return BINGE_OUTCOMES.locked
      }
      const { ids } = this.state({ account })
      if (!ids.includes(itemId) && ids.length >= BINGE_LIMIT) return BINGE_OUTCOMES.full
      this.db
        .prepare(
          `INSERT INTO binge_shows (account_id, item_id, added_at) VALUES (@account, ?, ?)
           ON CONFLICT (account_id, item_id) DO NOTHING`,
        )
        .run({ account }, itemId, new Date().toISOString())
      this.dismissTip({ account })
      return BINGE_OUTCOMES.done
    })()
  }

  dismissTip({ account }: BingeShowsDismissTipProps): void {
    this.db
      .prepare('INSERT INTO binge_tips (account_id) VALUES (@account) ON CONFLICT DO NOTHING')
      .run({ account })
  }
}
