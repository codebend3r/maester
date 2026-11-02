import { type ItemSummary, type MatchItemType, type MediaItem, type MediaSort } from '@raven/core'
import type { ComponentType } from 'react'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { SkeletonCards } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/MediaGrid/MediaGrid.module.scss'

/** How the grid draws each card: as a poster, or as a frame grab. */
const CARD_KINDS = { poster: 'poster', frame: 'frame' } as const

type CardKind = (typeof CARD_KINDS)[keyof typeof CARD_KINDS]

type GridCardProps = {
  media: MediaItem
  matchType: MatchItemType | null
  sort?: MediaSort
  posterOf?: (media: MediaItem) => ItemSummary | null
}

type GridPosterCardProps = GridCardProps

const GridPosterCard = ({ media, matchType, sort, posterOf }: GridPosterCardProps) => (
  <PosterCard
    media={media}
    poster={posterOf?.(media)}
    matchType={matchType}
    sort={sort}
    sizes={POSTER_SIZES.grid}
  />
)

type GridFrameCardProps = GridCardProps

const GridFrameCard = ({ media, matchType, sort }: GridFrameCardProps) => (
  <MediaCard media={media} matchType={matchType} sort={sort} />
)

const GRID_CARDS = {
  [CARD_KINDS.poster]: GridPosterCard,
  [CARD_KINDS.frame]: GridFrameCard,
} as const satisfies Record<CardKind, ComponentType<GridCardProps>>

type CardKindOfProps = { hasPosters: boolean }

const cardKindOf = ({ hasPosters }: CardKindOfProps): CardKind =>
  hasPosters ? CARD_KINDS.poster : CARD_KINDS.frame

type MediaGridProps = {
  items: MediaItem[]
  posters?: boolean
  matchType?: MatchItemType | null
  sort?: MediaSort
  /** The item whose poster a card shows, when not the video's own: an episode's season. */
  posterOf?: (media: MediaItem) => ItemSummary | null
}

/**
 * The card grid a library and the favourites share; `posters` lays a Movies
 * library out as posters, and `sort` has each card show the value it is in
 * order by.
 */
export const MediaGrid = ({
  items,
  posters = false,
  matchType = null,
  sort,
  posterOf,
}: MediaGridProps) => {
  const Card: ComponentType<GridCardProps> = GRID_CARDS[cardKindOf({ hasPosters: posters })]
  return (
    <ul className={posters ? `${styles.grid} ${styles.posters}` : styles.grid}>
      {items.map((item) => (
        <Card key={item.id} media={item} matchType={matchType} sort={sort} posterOf={posterOf} />
      ))}
    </ul>
  )
}

type MediaGridSkeletonProps = {
  posters?: boolean
  count?: number
}

/** The grid while its cards are on their way: stand-ins shaped as its cards, posters or frame grabs. */
export const MediaGridSkeleton = ({ posters = false, count }: MediaGridSkeletonProps) => (
  <ul className={posters ? `${styles.grid} ${styles.posters}` : styles.grid}>
    <SkeletonCards picture={cardKindOf({ hasPosters: posters })} count={count} />
  </ul>
)
