import { type ItemSummary, type MatchItemType, type MediaItem, type MediaSort } from '@raven/core'
import type { ComponentType } from 'react'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { SkeletonCards } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/MediaGrid/MediaGrid.module.scss'
import { CARD_PICTURES, type CardPicture } from '@/lib/cardPictures'
import { classNames } from '@raven/ui'

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

/** How the grid draws each card: as a poster, or as a frame grab. */
const GRID_CARDS = {
  [CARD_PICTURES.poster]: GridPosterCard,
  [CARD_PICTURES.frame]: GridFrameCard,
} as const satisfies Record<CardPicture, ComponentType<GridCardProps>>

/** The grid's own look for each picture. */
const GRID_CLASSES = {
  [CARD_PICTURES.poster]: classNames([styles.grid, styles.posters]),
  [CARD_PICTURES.frame]: styles.grid,
} as const satisfies Record<CardPicture, string>

type MediaGridProps = {
  items: MediaItem[]
  picture?: CardPicture
  matchType?: MatchItemType | null
  sort?: MediaSort
  /** The item whose poster a card shows, when not the video's own: an episode's season. */
  posterOf?: (media: MediaItem) => ItemSummary | null
}

/**
 * The card grid a library and the favourites share; `picture` lays a Movies
 * library out as posters, and `sort` has each card show the value it is in
 * order by.
 */
export const MediaGrid = ({
  items,
  picture = CARD_PICTURES.frame,
  matchType = null,
  sort,
  posterOf,
}: MediaGridProps) => {
  const Card: ComponentType<GridCardProps> = GRID_CARDS[picture]
  return (
    <ul className={GRID_CLASSES[picture]}>
      {items.map((item) => (
        <Card key={item.id} media={item} matchType={matchType} sort={sort} posterOf={posterOf} />
      ))}
    </ul>
  )
}

type MediaGridSkeletonProps = {
  picture?: CardPicture
  count?: number
}

/** The grid while its cards are on their way: stand-ins shaped as its cards, posters or frame grabs. */
export const MediaGridSkeleton = ({
  picture = CARD_PICTURES.frame,
  count,
}: MediaGridSkeletonProps) => (
  <ul className={GRID_CLASSES[picture]}>
    <SkeletonCards picture={picture} count={count} />
  </ul>
)
