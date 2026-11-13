import { type MediaItem, SHUFFLE_LENGTH, queueLink, shuffled } from '@raven/core'
import { isNone } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'
import { inProgressQuery } from '@/lib/queries'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import {
  EntryGrid,
  SectionQuery,
  type SectionProps,
  libraryCardPicture,
} from '@/pages/LibraryPage/sections/sectionParts'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/**
 * What was left partway through, the most recently watched first, under
 * Play, which picks them up in that order, and Shuffle.
 */
export const InProgressSection = ({ library }: SectionProps) => {
  const query = useQuery(inProgressQuery(library.id))
  const navigate = useNavigate()
  const media = query.data?.map((entry) => entry.media) ?? []
  const play = (queue: MediaItem[]) => {
    const link = queueLink({ queue: queue.slice(0, SHUFFLE_LENGTH) })
    if (link) navigate(link.to, { state: link.state })
  }
  return (
    <div className={styles.section}>
      <div className={styles.playRow}>
        <PlayButtons
          playable={media.length > 0}
          onPlay={() => play(media)}
          onShuffle={() => play(shuffled({ items: media }))}
        />
      </div>
      <SectionQuery
        query={query}
        shape={<MediaGridSkeleton picture={libraryCardPicture(library)} />}
        isEmpty={isNone}
        empty={
          library.settings.saveProgress
            ? LIBRARY_COPY.inProgressEmpty(library.name)
            : LIBRARY_COPY.inProgressUnsaved(library.name)
        }
      >
        {(entries) => <EntryGrid library={library} entries={entries} />}
      </SectionQuery>
    </div>
  )
}
