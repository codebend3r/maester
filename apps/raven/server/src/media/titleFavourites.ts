import { Inject, Injectable } from '@nestjs/common'
import { ITEM_TYPES, type ItemSummary, type ItemType } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FAVOURITE_OUTCOMES, type FavouriteOutcome } from '@/media/favouriteOutcomes'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** A movie or episode is a favourite by its files; a show or season by itself. */
const FAVOURITE_TITLE_TYPES: ReadonlySet<ItemType> = new Set([ITEM_TYPES.show, ITEM_TYPES.season])

/**
 * Shows and seasons marked as favourites. A locked library's are left out,
 * whether or not the PIN is entered: one that only locked libraries hold can
 * never be marked, and is never listed.
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

  /** Whether a library that is not locked holds a file under the item. */
  private isOpen({ itemId, locked }: { itemId: number; locked: ReadonlySet<number> }): boolean {
    return this.metadata.librariesHolding(itemId).some((libraryId) => !locked.has(libraryId))
  }

  /** Whether the item is a show or season a library that is not locked holds. */
  canBeFavourite(itemId: number): boolean {
    const type = this.metadata.get(itemId)?.type
    return (
      type != null &&
      FAVOURITE_TITLE_TYPES.has(type) &&
      this.isOpen({ itemId, locked: this.libraries.lockedIds() })
    )
  }

  /** A show's or season's mark, or null where it cannot have one, as `ItemDetails.favourite` says. */
  favouriteOf(itemId: number): boolean | null {
    if (!this.canBeFavourite(itemId)) return null
    return !!this.db
      .prepare<[number], { item_id: number }>(
        'SELECT item_id FROM item_favourites WHERE item_id = ?',
      )
      .get(itemId)
  }

  /**
   * Marking a favourite again keeps its original time, so the list does not
   * reshuffle. Unmarking always goes through, so a favourite left behind in
   * a library locked since can still be cleared.
   */
  set({ itemId, favourite }: { itemId: number; favourite: boolean }): FavouriteOutcome {
    return this.db.transaction(() => {
      const type = this.metadata.get(itemId)?.type
      if (type == null || !FAVOURITE_TITLE_TYPES.has(type)) return FAVOURITE_OUTCOMES.missing
      if (!favourite) {
        this.db.prepare('DELETE FROM item_favourites WHERE item_id = ?').run(itemId)
        return FAVOURITE_OUTCOMES.done
      }
      if (!this.isOpen({ itemId, locked: this.libraries.lockedIds() })) {
        return FAVOURITE_OUTCOMES.locked
      }
      this.db
        .prepare(
          `INSERT INTO item_favourites (item_id, added_at) VALUES (?, ?)
           ON CONFLICT (item_id) DO NOTHING`,
        )
        .run(itemId, new Date().toISOString())
      return FAVOURITE_OUTCOMES.done
    })()
  }

  /** Every favourite show and season a library that is not locked holds, most recently marked first. */
  list(): ItemSummary[] {
    const locked = this.libraries.lockedIds()
    const ids = this.db
      .prepare<[], { item_id: number }>(
        'SELECT item_id FROM item_favourites ORDER BY added_at DESC, item_id DESC',
      )
      .all()
      .map((row) => row.item_id)
      .filter((itemId) => this.isOpen({ itemId, locked }))
    const summaries = this.metadata.summaries(ids)
    return ids.flatMap((id) => summaries.get(id) ?? [])
  }
}
