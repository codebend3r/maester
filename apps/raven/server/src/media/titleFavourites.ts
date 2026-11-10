import { Inject, Injectable } from '@nestjs/common'
import { ITEM_TYPES, type ItemSummary, type ItemType } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FAVOURITE_OUTCOMES, type FavouriteOutcome } from '@/media/favouriteOutcomes'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** A movie or episode is a favourite by its files; a show or season by itself. */
const FAVOURITE_TITLE_TYPES: ReadonlySet<ItemType> = new Set([ITEM_TYPES.show, ITEM_TYPES.season])

type TitleFavouritesFavouriteOfProps = { itemId: number; account: AccountKey }

type TitleFavouritesSetProps = {
  itemId: number
  favourite: boolean
  account: AccountKey
}

/** `libraryId` narrows the list to the one library; null takes every library that is not locked. */
type TitleFavouritesListProps = { account: AccountKey; libraryId: number | null }

type TitleFavouritesHeldInProps = {
  itemId: number
  locked: ReadonlySet<number>
  libraryId: number | null
}

/**
 * Shows and seasons each account marked as favourites. A locked library's
 * are left out, whether or not the PIN is entered: one that only locked
 * libraries hold can never be marked, and is never listed.
 */
@Injectable()
export class TitleFavourites {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /** Whether a library that is not locked, `libraryId` where given, holds a file under the item. */
  private isHeldIn({ itemId, locked, libraryId }: TitleFavouritesHeldInProps): boolean {
    return this.metadata
      .librariesHolding(itemId)
      .some((held) => !locked.has(held) && (libraryId == null || held === libraryId))
  }

  /** Whether the item is a show or season a library that is not locked holds. */
  canBeFavourite(itemId: number): boolean {
    const type = this.metadata.get(itemId)?.type
    return (
      type != null &&
      FAVOURITE_TITLE_TYPES.has(type) &&
      this.isHeldIn({ itemId, locked: this.libraries.lockedIds(), libraryId: null })
    )
  }

  /**
   * `account`'s mark on a show or season, or null where it cannot have one,
   * as `ItemDetails.favourite` says.
   */
  favouriteOf({ itemId, account }: TitleFavouritesFavouriteOfProps): boolean | null {
    if (!this.canBeFavourite(itemId)) return null
    return !!this.db
      .prepare<[ByAccount, number], { item_id: number }>(
        'SELECT item_id FROM item_favourites WHERE account_id = @account AND item_id = ?',
      )
      .get({ account }, itemId)
  }

  /**
   * Marking a favourite again keeps its original time, so the list does not
   * reshuffle. Unmarking always goes through, so a favourite left behind in
   * a library locked since can still be cleared.
   */
  set({ itemId, favourite, account }: TitleFavouritesSetProps): FavouriteOutcome {
    return this.db.transaction(() => {
      const type = this.metadata.get(itemId)?.type
      if (type == null || !FAVOURITE_TITLE_TYPES.has(type)) return FAVOURITE_OUTCOMES.missing
      if (!favourite) {
        this.db
          .prepare('DELETE FROM item_favourites WHERE account_id = @account AND item_id = ?')
          .run({ account }, itemId)
        return FAVOURITE_OUTCOMES.done
      }
      if (!this.isHeldIn({ itemId, locked: this.libraries.lockedIds(), libraryId: null })) {
        return FAVOURITE_OUTCOMES.locked
      }
      this.db
        .prepare(
          `INSERT INTO item_favourites (account_id, item_id, added_at) VALUES (@account, ?, ?)
           ON CONFLICT (account_id, item_id) DO NOTHING`,
        )
        .run({ account }, itemId, new Date().toISOString())
      return FAVOURITE_OUTCOMES.done
    })()
  }

  /** The ids `list` would hand back, newest mark first, read without their summaries. */
  private ids({ account, libraryId }: TitleFavouritesListProps): number[] {
    const locked = this.libraries.lockedIds()
    return this.db
      .prepare<ByAccount, { item_id: number }>(
        `SELECT item_id FROM item_favourites WHERE account_id = @account
          ORDER BY added_at DESC, item_id DESC`,
      )
      .all({ account })
      .map((row) => row.item_id)
      .filter((itemId) => this.isHeldIn({ itemId, locked, libraryId }))
  }

  /** How many shows and seasons `list` would hand back, without reading them. */
  count(props: TitleFavouritesListProps): number {
    return this.ids(props).length
  }

  /**
   * Every show and season `account` favoured that a library that is not
   * locked holds, or that `libraryId` holds, most recently marked first.
   */
  list({ account, libraryId }: TitleFavouritesListProps): ItemSummary[] {
    const ids = this.ids({ account, libraryId })
    const summaries = this.metadata.summaries({ ids, libraryId })
    return ids.flatMap((id) => summaries.get(id) ?? [])
  }
}
