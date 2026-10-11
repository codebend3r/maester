import type { MediaItem, ShownRatings } from '@raven/core'
import type { MatchType } from '@/components/FixMatchDialog/FixMatchDialog'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import styles from '@/components/MediaGrid/MediaGrid.module.scss'

/** The card grid a library and the favourites share; `posters` lays a Movies library out as posters. */
export const MediaGrid = ({
  items,
  busy = false,
  posters = false,
  matchType = null,
  ratingsSource = 'tmdb',
}: {
  items: MediaItem[]
  busy?: boolean
  posters?: boolean
  matchType?: MatchType | null
  ratingsSource?: ShownRatings
}) => (
  <ul className={posters ? `${styles.grid} ${styles.posters}` : styles.grid} aria-busy={busy}>
    {items.map((item) =>
      posters ? (
        <PosterCard key={item.id} media={item} ratingsSource={ratingsSource} />
      ) : (
        <MediaCard key={item.id} media={item} matchType={matchType} />
      ),
    )}
  </ul>
)
