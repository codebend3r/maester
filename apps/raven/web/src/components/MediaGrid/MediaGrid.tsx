import type { ItemSummary, MatchItemType, MediaItem, MediaSort, RatingSource } from '@raven/core'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { SkeletonCards } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/MediaGrid/MediaGrid.module.scss'

/**
 * The card grid a library and the favourites share; `posters` lays a Movies
 * library out as posters, and `sort` has each card show the value it is in
 * order by.
 */
export const MediaGrid = ({
  items,
  posters = false,
  matchType = null,
  ratingsSource = 'tmdb',
  sort,
  posterOf,
}: {
  items: MediaItem[]
  posters?: boolean
  matchType?: MatchItemType | null
  ratingsSource?: RatingSource
  sort?: MediaSort
  /** The item whose poster a card shows, when not the video's own: an episode's season. */
  posterOf?: (media: MediaItem) => ItemSummary | null
}) => (
  <ul className={posters ? `${styles.grid} ${styles.posters}` : styles.grid}>
    {items.map((item) =>
      posters ? (
        <PosterCard
          key={item.id}
          media={item}
          poster={posterOf?.(item)}
          matchType={matchType}
          ratingsSource={ratingsSource}
          sort={sort}
          sizes={POSTER_SIZES.grid}
        />
      ) : (
        <MediaCard key={item.id} media={item} matchType={matchType} sort={sort} />
      ),
    )}
  </ul>
)

/** The grid while its cards are on their way: stand-ins shaped as its cards, posters or frame grabs. */
export const MediaGridSkeleton = ({
  posters = false,
  count,
}: {
  posters?: boolean
  count?: number
}) => (
  <ul className={posters ? `${styles.grid} ${styles.posters}` : styles.grid}>
    <SkeletonCards picture={posters ? 'poster' : 'frame'} count={count} />
  </ul>
)
