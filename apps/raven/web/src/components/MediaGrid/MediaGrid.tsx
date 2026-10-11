import type { MediaItem } from '@raven/core'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import styles from '@/components/MediaGrid/MediaGrid.module.scss'

/** The card grid a library and the favourites share; `posters` lays a Movies library out as posters. */
export const MediaGrid = ({
  items,
  busy = false,
  posters = false,
}: {
  items: MediaItem[]
  busy?: boolean
  posters?: boolean
}) => (
  <ul className={posters ? `${styles.grid} ${styles.posters}` : styles.grid} aria-busy={busy}>
    {items.map((item) =>
      posters ? (
        <PosterCard key={item.id} media={item} />
      ) : (
        <MediaCard key={item.id} media={item} />
      ),
    )}
  </ul>
)
