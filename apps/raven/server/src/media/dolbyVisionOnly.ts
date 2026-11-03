import { Inject, Injectable } from '@nestjs/common'
import { type DolbyVisionOnlyListing, type MediaItem, sortTitle } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { MediaRepository } from '@/media/mediaRepository'
import type { AccountKey } from '@/media/viewingAccountKeys'

/** A library's Dolby Vision profile 5 files, matched to an episode or not. */
const DOLBY_VISION_ONLY_FILES = `
  SELECT m.id AS media_id, s.parent_id AS show_id, e.id AS episode_id
    FROM media m
    LEFT JOIN media_items mi ON mi.media_id = m.id
    LEFT JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
    LEFT JOIN shown_items s ON s.id = e.parent_id
   WHERE m.library_id = ? AND m.dolby_vision_only = 1`

/** Each show's Dolby Vision profile 5 episodes, and the files that are no show's episode. */
const SPLIT = `
  WITH files AS (${DOLBY_VISION_ONLY_FILES})
  SELECT show_id, COUNT(DISTINCT episode_id) AS episodes, NULL AS media_id
    FROM files WHERE show_id IS NOT NULL GROUP BY show_id
  UNION ALL
  SELECT DISTINCT NULL, 0, media_id FROM files
   WHERE media_id NOT IN (SELECT media_id FROM files WHERE show_id IS NOT NULL)`

type SplitRow = { show_id: number | null; episodes: number; media_id: number | null }

type DolbyVisionOnlyProps = { libraryId: number; account: AccountKey }

const titleOf = (media: MediaItem): string => sortTitle(media.item?.title ?? media.title)

/**
 * What in a library is Dolby Vision profile 5, which no browser can show:
 * the shows with such episodes, how many each, and every other such file.
 * Kept apart from the listings, which it reads through, so their queries
 * stay as they are.
 */
@Injectable()
export class DolbyVisionOnly {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaRepository) private readonly media: MediaRepository,
  ) {}

  private split(libraryId: number): SplitRow[] {
    return this.database.db.prepare<[number], SplitRow>(SPLIT).all(libraryId)
  }

  /** The library's shows with profile 5 episodes, by title, and its other profile 5 files, by title. */
  list({ libraryId, account }: DolbyVisionOnlyProps): DolbyVisionOnlyListing {
    const rows = this.split(libraryId)
    const episodes = new Map(
      rows.flatMap((row) => (row.show_id == null ? [] : [[row.show_id, row.episodes] as const])),
    )
    const shows =
      episodes.size === 0
        ? []
        : this.media.listShows({ libraryId, showIds: [...episodes.keys()], account })
    const files = this.media
      .getMany({ ids: rows.flatMap((row) => row.media_id ?? []), account })
      .toSorted((a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' }))
    return {
      shows: shows.map((entry) => ({ entry, episodes: episodes.get(entry.show.id) ?? 0 })),
      files: this.media.withPosters(files),
    }
  }

  /** How many titles `list` lists: its shows and its other files, without reading them. */
  count(libraryId: number): number {
    return this.split(libraryId).length
  }
}
