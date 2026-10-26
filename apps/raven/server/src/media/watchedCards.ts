import { Inject, Injectable } from '@nestjs/common'
import { WATCH_TARGET_KINDS, type WatchTarget } from '@raven/core'
import { DatabaseService } from '@/db/database'
import type { Viewer } from '@/lock/lockService'
import { BEST_FIRST } from '@/media/mediaSql'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** A file of a card, with the length that a mark records as how far it got. */
type WatchFile = { id: number; duration: number | null }

/**
 * What a listing shows as one entry, in one library: the files of a movie
 * that share its card, an episode's files, or a file matched to nothing.
 * Best file first.
 */
export type WatchCard = { files: readonly WatchFile[] }

type CardRow = {
  item_id: number
  library_id: number
  split: string | null
  id: number
  duration: number | null
}

type WatchedCardsResolveProps = { targets: readonly WatchTarget[]; viewer: Viewer }

type WatchedCardsOfFileProps = { id: number; viewer: Viewer }

type WatchedCardsOfItemProps = {
  itemId: number
  libraryId: number | null
  viewer: Viewer
}

type WatchedCardsCardsOfProps = {
  itemIds: readonly number[]
  libraryId: number | null
  split: { only: string | null } | null
  viewer: Viewer
}

/**
 * Turns what a viewer picked into the cards to mark. A card is what the
 * listings count as one entry, so the rule is written once over cards and a
 * new target kind (an album, a playlist) only has to resolve to them.
 */
@Injectable()
export class WatchedCards {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /**
   * The cards `targets` name, in libraries `viewer` sees. A target naming
   * nothing, or only what the viewer may not see, resolves to none, so the
   * answer never tells a hidden library is there.
   */
  resolve({ targets, viewer }: WatchedCardsResolveProps): WatchCard[] {
    return targets.flatMap((target): WatchCard[] => {
      switch (target.kind) {
        case WATCH_TARGET_KINDS.media:
          return this.ofFile({ id: target.id, viewer })
        case WATCH_TARGET_KINDS.item:
          return this.ofItem({ itemId: target.id, libraryId: target.libraryId, viewer })
        default: {
          const unknown: never = target
          return unknown
        }
      }
    })
  }

  /** The card a file is on: its first item's files in its library with its `split`, or the file alone. */
  private ofFile({ id, viewer }: WatchedCardsOfFileProps): WatchCard[] {
    const file = this.db
      .prepare<
        [number],
        {
          library_id: number
          split: string | null
          duration: number | null
          item_id: number | null
        }
      >(
        `SELECT m.library_id, m.split, m.duration,
                (SELECT MIN(mi.item_id) FROM media_items mi WHERE mi.media_id = m.id) AS item_id
           FROM media m WHERE m.id = ?`,
      )
      .get(id)
    if (!file || !viewer.seesLibrary(file.library_id)) return []
    if (file.item_id == null) return [{ files: [{ id, duration: file.duration }] }]
    return this.cardsOf({
      itemIds: [file.item_id],
      libraryId: file.library_id,
      split: { only: file.split },
      viewer,
    })
  }

  /** A card for each movie and episode under the item, in `libraryId` or in every library the viewer sees. */
  private ofItem({ itemId, libraryId, viewer }: WatchedCardsOfItemProps): WatchCard[] {
    return this.cardsOf({
      itemIds: this.metadata.itemsUnder(itemId),
      libraryId,
      split: null,
      viewer,
    })
  }

  /**
   * One card for each movie or episode among `itemIds`, library and `split`
   * the files sit on, in `libraryId` or any the viewer sees; `split` limits
   * a movie to one of its cards. Reading by item, not by file, keeps a file
   * holding two episodes on both their cards.
   */
  private cardsOf({ itemIds, libraryId, split, viewer }: WatchedCardsCardsOfProps): WatchCard[] {
    if (libraryId != null && !viewer.seesLibrary(libraryId)) return []
    const rows = this.db
      .prepare<
        { itemIds: string; libraryId: number | null; anySplit: number; split: string | null },
        CardRow
      >(
        `SELECT x.item_id, m.library_id, m.split, m.id, m.duration
           FROM media_items x
           JOIN items i ON i.id = x.item_id AND i.type IN ('movie', 'episode')
           JOIN media m ON m.id = x.media_id
          WHERE x.item_id IN (SELECT value FROM json_each(@itemIds))
            AND (@libraryId IS NULL OR m.library_id = @libraryId)
            AND (@anySplit = 1 OR m.split IS @split)
          ORDER BY x.item_id, m.library_id, COALESCE(m.split, ''), ${BEST_FIRST}`,
      )
      .all({
        itemIds: JSON.stringify(itemIds),
        libraryId,
        anySplit: split == null ? 1 : 0,
        split: split?.only ?? null,
      })
    const cards = rows
      .filter((row) => viewer.seesLibrary(row.library_id))
      .reduce((byCard, row) => {
        const key = `${row.item_id}|${row.library_id}|${row.split ?? ''}`
        const file = { id: row.id, duration: row.duration }
        return byCard.set(key, [...(byCard.get(key) ?? []), file])
      }, new Map<string, WatchFile[]>())
    return [...cards.values()].map((files) => ({ files }))
  }
}
