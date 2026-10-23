import {
  type MediaItem,
  type ShowEntry,
  cardLink,
  cardTitle,
  mediaEntryKey,
  showEntryKey,
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

/**
 * One cover and nothing else: the picture is the link to its page, named
 * by its title since no words show, and grows a little toward the pointer.
 */
const Cover = ({
  entry,
  title,
  link,
  children,
}: {
  entry: string
  title: string
  link: Pick<ComponentProps<typeof CardLink>, 'to' | 'state' | 'prefetchItem'>
  children: ReactNode
}) => {
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

/** The grid of covers, posters or frame grabs, side by side with little between. */
const CoverList = ({ posters, children }: { posters: boolean; children: ReactNode }) => (
  <ul className={posters ? `${styles.grid} ${styles.posters}` : styles.grid}>{children}</ul>
)

/**
 * A library's videos as nothing but their covers, each opening the video's
 * page, or the player for one with no page: posters for a library that is
 * matched, frame grabs for one that is not.
 */
export const MediaCovers = ({ items, posters }: { items: MediaItem[]; posters: boolean }) => (
  <CoverList posters={posters}>
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

/** A TV library's shows as nothing but their posters, each opening the show's page. */
export const ShowCovers = ({ shows }: { shows: ShowEntry[] }) => (
  <CoverList posters>
    {shows.map(({ show }) => (
      <Cover
        key={show.id}
        entry={showEntryKey(show)}
        title={show.title}
        link={{ to: `/shows/${show.id}`, prefetchItem: show.id }}
      >
        <ItemPoster item={show} sizes={POSTER_SIZES.cover} />
      </Cover>
    ))}
  </CoverList>
)

/** How many blank covers stand in: a screen's worth at 1440 wide. */
const SKELETON_COUNT = 24

/** The covers while they are on their way: blank pictures in their places. */
export const CoverGridSkeleton = ({ posters }: { posters: boolean }) => (
  <CoverList posters={posters}>
    {Array.from({ length: SKELETON_COUNT }, (_, index) => (
      <li key={index} className={styles.cover}>
        <Bone shape={posters ? 'poster' : 'frame'} />
      </li>
    ))}
  </CoverList>
)
