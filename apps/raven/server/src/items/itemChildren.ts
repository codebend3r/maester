import { ITEM_TYPES, type ItemChild, type ItemSummary, primaryVersion } from '@raven/core'
import type { Viewer } from '@/lock/lockService'
import type { MediaRepository } from '@/media/mediaRepository'
import type { AccountKey } from '@/media/viewingAccountKeys'
import type { MetadataRepository } from '@/metadata/metadataRepository'

type OfTypeProps<T extends ItemSummary['type']> = {
  children: readonly ItemSummary[]
  type: T
}

const ofType = <T extends ItemSummary['type']>({ children, type }: OfTypeProps<T>): number[] =>
  children.flatMap((child) => (child.type === type ? [child.id] : []))

type ItemChildrenProps = {
  parentId: number
  viewer: Viewer
  metadata: MetadataRepository
  media: MediaRepository
  account: AccountKey
}

/**
 * A show's seasons or a season's episodes on disk, as its page lists them:
 * a season with how many of its episodes this caller may see, an episode
 * with its row's words and the file Play starts. Both count what `account`
 * watched in the libraries this caller may see only. Read a few queries for
 * the whole list, never one per child.
 */
export const itemChildren = ({
  parentId,
  viewer,
  metadata,
  media,
  account,
}: ItemChildrenProps): ItemChild[] => {
  const children = metadata.childrenOnDisk(parentId).filter((child) => viewer.seesItem(child.id))
  const episodeIds = ofType({ children, type: ITEM_TYPES.episode })
  const onDisk = metadata.episodesOnDisk(ofType({ children, type: ITEM_TYPES.season }))
  const rows = metadata.episodeRows(episodeIds)
  const files = media.forItems({ itemIds: episodeIds, account })
  const watched = new Set(
    media
      .watchedEpisodes({ ids: [...episodeIds, ...[...onDisk.values()].flat()], account })
      .flatMap(({ episodeId, libraryId }) => (viewer.seesLibrary(libraryId) ? [episodeId] : [])),
  )
  return children.flatMap((child): ItemChild[] => {
    switch (child.type) {
      case ITEM_TYPES.season: {
        const shown = (onDisk.get(child.id) ?? []).filter((id) => viewer.seesItem(id))
        return [
          {
            ...child,
            type: ITEM_TYPES.season,
            episodeCount: shown.length,
            watchedCount: shown.filter((id) => watched.has(id)).length,
          },
        ]
      }
      case ITEM_TYPES.episode: {
        const row = rows.get(child.id)
        const visible = (files.get(child.id) ?? []).filter((file) =>
          viewer.seesLibrary(file.libraryId),
        )
        return [
          {
            ...child,
            type: ITEM_TYPES.episode,
            summary: row?.summary ?? null,
            released: row?.released ?? null,
            runtime: row?.runtime ?? null,
            stillVersion: row?.stillVersion ?? null,
            watched: watched.has(child.id),
            primary: primaryVersion(visible) ?? null,
          },
        ]
      }
      // A movie or show is never a child.
      case ITEM_TYPES.movie:
      case ITEM_TYPES.show:
        return []
      default: {
        const unknown: never = child.type
        return unknown
      }
    }
  })
}
