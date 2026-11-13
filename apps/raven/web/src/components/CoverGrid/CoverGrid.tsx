import {
  type MediaItem,
  type ShowEntry,
  cardLink,
  cardTitle,
  mediaEntryKey,
  showEntryKey,
  showPath,
} from '@raven/core'
import type { ComponentProps, ReactNode } from 'react'
import { CardLink } from '@/components/CardLink/CardLink'
import { ItemPoster, PosterImage } from '@/components/PosterImage/PosterImage'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { Bone } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import { pageItemOf } from '@/lib/prefetchItem'
import { useSelectable } from '@/lib/useSelectable'
import styles from '@/components/CoverGrid/CoverGrid.module.scss'
import { CARD_PICTURES, type CardPicture } from '@/lib/cardPictures'
import { classNames } from '@raven/ui'

type CoverProps = {
  entry: string
  title: string
  link: Pick<ComponentProps<typeof CardLink>, 'to' | 'state' | 'prefetchItem'>
  children: ReactNode
}

/**
 * One cover and nothing else: the picture is the link to its page, named
 * by its title since no words show, and grows a little toward the pointer.
 */
const Cover = ({ entry, title, link, children }: CoverProps) => {
  const select = useSelectable({ key: entry, title })
  return (
    <li className={styles.cover} data-entry={entry} {...select.rootProps}>
      <CardLink
        {...link}
        className={styles.picture}
        aria-label={title}
        title={title}
        tabIndex={select.linkTabIndex}
      >
        {children}
      </CardLink>
      <SelectCheckbox select={select} className={styles.select} />
    </li>
  )
}

const COVER_CLASSES = {
  [CARD_PICTURES.poster]: classNames([styles.grid, styles.posters]),
  [CARD_PICTURES.frame]: styles.grid,
} as const satisfies Record<CardPicture, string>

type CoverListProps = { picture: CardPicture; children: ReactNode }

/** The grid of covers, posters or frame grabs, side by side with little between. */
const CoverList = ({ picture, children }: CoverListProps) => (
  <ul className={COVER_CLASSES[picture]}>{children}</ul>
)

type MediaCoversProps = { items: MediaItem[]; picture: CardPicture }

/**
 * A library's videos as nothing but their covers, each opening the video's
 * page, or the player for one with no page: posters for a library that is
 * matched, frame grabs for one that is not.
 */
export const MediaCovers = ({ items, picture }: MediaCoversProps) => (
  <CoverList picture={picture}>
    {items.map((media) => (
      <Cover
        key={media.id}
        entry={mediaEntryKey(media)}
        title={cardTitle(media).title}
        link={{ ...cardLink({ media, hasPages: true }), prefetchItem: pageItemOf(media) }}
      >
        <PosterImage media={media} sizes={POSTER_SIZES.cover} />
      </Cover>
    ))}
  </CoverList>
)

type ShowCoversProps = { shows: ShowEntry[] }

/** A TV library's shows as nothing but their posters, each opening the show's page. */
export const ShowCovers = ({ shows }: ShowCoversProps) => (
  <CoverList picture={CARD_PICTURES.poster}>
    {shows.map(({ show }) => (
      <Cover
        key={show.id}
        entry={showEntryKey(show)}
        title={show.title}
        link={{ to: showPath(show.id), prefetchItem: show.id }}
      >
        <ItemPoster item={show} sizes={POSTER_SIZES.cover} />
      </Cover>
    ))}
  </CoverList>
)

/** How many blank covers stand in: a screen's worth at 1440 wide. */
const SKELETON_COUNT = 24

type CoverGridSkeletonProps = { picture: CardPicture }

/** The covers while they are on their way: blank pictures in their places. */
export const CoverGridSkeleton = ({ picture }: CoverGridSkeletonProps) => (
  <CoverList picture={picture}>
    {Array.from({ length: SKELETON_COUNT }, (_, index) => (
      <li key={index} className={styles.cover}>
        <Bone shape={picture} />
      </li>
    ))}
  </CoverList>
)
