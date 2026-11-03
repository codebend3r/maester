import type { HistoryEntry, MediaItem } from '@raven/core'
import type { PlayedEntry } from '@/media/viewingRepository'
import type { MetadataRepository } from '@/metadata/metadataRepository'

/** The item whose poster a played video stands under: an episode's show, else its own item. */
const posterItemOf = (media: MediaItem): number | null =>
  media.item?.show?.id ?? media.item?.id ?? null

type WithShowPostersProps = {
  entries: readonly PlayedEntry[]
  libraryId: number
  metadata: MetadataRepository
}

/**
 * Each played video with the poster it stands under, as `libraryId` shows
 * it: an episode's show's, a movie's own, null for a file matched to nothing.
 */
export const withShowPosters = ({
  entries,
  libraryId,
  metadata,
}: WithShowPostersProps): HistoryEntry[] => {
  const posters = metadata.posterItems({
    libraryId,
    ids: entries.flatMap(({ media }) => posterItemOf(media) ?? []),
  })
  return entries.map((entry) => {
    const id = posterItemOf(entry.media)
    return { ...entry, poster: id == null ? null : (posters.get(id) ?? null) }
  })
}
