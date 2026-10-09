import type { MediaItem } from '@raven/core'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import styles from '@/components/MediaGrid/MediaGrid.module.scss'

/** The card grid a library and the favourites share. */
export const MediaGrid = ({ items, busy = false }: { items: MediaItem[]; busy?: boolean }) => (
  <ul className={styles.grid} aria-busy={busy}>
    {items.map((item) => (
      <MediaCard key={item.id} media={item} />
    ))}
  </ul>
)
