import { type ItemChild, type ItemSummary, primaryVersion } from '@raven/core'
import type { Viewer } from '@/lock/lockService'
import type { MediaRepository } from '@/media/mediaRepository'
import type { MetadataRepository } from '@/metadata/metadataRepository'

const ofType = <T extends ItemSummary['type']>({
  children,
  type,
}: {
  children: readonly ItemSummary[]
  type: T
}): number[] => children.flatMap((child) => (child.type === type ? [child.id] : []))

/**
 * A show's seasons or a season's episodes on disk, as its page lists them:
 * a season with how many of its episodes this browser may see, an episode
 * with its row's words and the file Play starts. Both count what is watched
 * in the libraries this browser may see only. Read a few queries for the
 * whole list, never one per child.
 */
export const itemChildren = ({
  parentId,
  viewer,
  metadata,
  media,
}: {
  parentId: number
  viewer: Viewer
  metadata: MetadataRepository
  media: MediaRepository
}): ItemChild[] => {
  const children = metadata.childrenOnDisk(parentId).filter((child) => viewer.seesItem(child.id))
  const episodeIds = ofType({ children, type: 'episode' })
  const onDisk = metadata.episodesOnDisk(ofType({ children, type: 'season' }))
  const rows = metadata.episodeRows(episodeIds)
  const files = media.forItems(episodeIds)
  const watched = new Set(
    media
      .watchedEpisodes([...episodeIds, ...[...onDisk.values()].flat()])
      .flatMap(({ episodeId, libraryId }) => (viewer.seesLibrary(libraryId) ? [episodeId] : [])),
  )
  return children.flatMap((child): ItemChild[] => {
    switch (child.type) {
      case 'season': {
        const shown = (onDisk.get(child.id) ?? []).filter((id) => viewer.seesItem(id))
        return [
          {
            ...child,
            type: 'season',
            episodeCount: shown.length,
            watchedCount: shown.filter((id) => watched.has(id)).length,
          },
        ]
      }
      case 'episode': {
        const row = rows.get(child.id)
        const visible = (files.get(child.id) ?? []).filter((file) =>
          viewer.seesLibrary(file.libraryId),
        )
        return [
          {
            ...child,
            type: 'episode',
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
      case 'movie':
      case 'show':
        return []
      default: {
        const unknown: never = child.type
        return unknown
      }
    }
  })
}
