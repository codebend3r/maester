import { type AlbumSummary, KEYS, albumDateLabel } from '@raven/core'
import {
  type ComponentType,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useState,
} from 'react'
import { Link } from 'react-router-dom'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { Bone } from '@/components/Skeleton/Skeleton'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/AlbumGrid/AlbumGrid.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** What a card's hint is handed: its album, whether the pointer or the focus is on the card, and the id its title is described by. */
export type AlbumHintProps = { album: AlbumSummary; isShown: boolean; id: string }

type AlbumCardProps = {
  album: AlbumSummary
  /** Shown over the cover while the pointer or the focus is on the card. */
  hint?: ComponentType<AlbumHintProps>
}

/** The custom properties a card sets for its hint: the point, in the viewport, its top right corner sits at. */
const HINT_ANCHOR = { x: '--hint-x', y: '--hint-y' } as const

type AnchorAtProps = { card: HTMLLIElement; x: number; y: number }

// Set on the card as the pointer moves, so following it re-renders nothing.
const anchorAt = ({ card, x, y }: AnchorAtProps): void => {
  card.style.setProperty(HINT_ANCHOR.x, `${x}px`)
  card.style.setProperty(HINT_ANCHOR.y, `${y}px`)
}

const follow = (event: PointerEvent<HTMLLIElement>): void =>
  anchorAt({ card: event.currentTarget, x: event.clientX, y: event.clientY })

/** One album: its cover, linking to its page, with its title and artists under. */
export const AlbumCard = ({ album, hint: Hint }: AlbumCardProps) => {
  const links = useMusicLinks()
  const hintId = useId()
  const [isPeeked, setPeeked] = useState(false)
  const hide = (): void => setPeeked(false)
  const peekAtPointer = (event: PointerEvent<HTMLLIElement>): void => {
    follow(event)
    setPeeked(true)
  }
  // With no pointer, the hint hangs from the card's top right corner.
  const peekAtCard = (event: FocusEvent<HTMLLIElement>): void => {
    const { right, top } = event.currentTarget.getBoundingClientRect()
    anchorAt({ card: event.currentTarget, x: right, y: top })
    setPeeked(true)
  }
  // Focus moving between the card's own links keeps the hint up.
  const blur = (event: FocusEvent<HTMLLIElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) hide()
  }
  const escape = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.key === KEYS.escape) hide()
  }
  const peeking = Hint && {
    onPointerEnter: peekAtPointer,
    onPointerMove: follow,
    onPointerLeave: hide,
    onFocus: peekAtCard,
    onBlur: blur,
    onKeyDown: escape,
  }
  return (
    <li className={styles.card} data-entry={`album:${album.id}`} {...peeking}>
      {/* The title under it is the link read aloud; the cover is the same link for the pointer. */}
      <Link to={links.album(album.id)} className={styles.cover} aria-hidden="true" tabIndex={-1}>
        <AlbumCover album={album} sizes={POSTER_SIZES.grid} />
      </Link>
      {Hint && <Hint album={album} isShown={isPeeked} id={hintId} />}
      <p className={styles.title}>
        <Link to={links.album(album.id)} aria-describedby={Hint && isPeeked ? hintId : undefined}>
          {album.title}
        </Link>
      </p>
      <p className={styles.artists}>
        {album.artists.map((artist, index) => (
          <span key={artist.id}>
            {index > 0 && COMMON_COPY.listSeparator}
            <Link to={links.artist(artist.id)}>{artist.name}</Link>
          </span>
        ))}
      </p>
      {albumDateLabel(album) !== null && <p className={styles.year}>{albumDateLabel(album)}</p>}
    </li>
  )
}

type AlbumGridProps = { albums: readonly AlbumSummary[] } & Pick<AlbumCardProps, 'hint'>

/** Albums as a grid of covers, each named with its artists and year, and a hint over each cover when given one. */
export const AlbumGrid = ({ albums, hint }: AlbumGridProps) => (
  <ul className={styles.grid}>
    {albums.map((album) => (
      <AlbumCard key={album.id} album={album} hint={hint} />
    ))}
  </ul>
)

/** How many blank covers stand in while the albums are on their way. */
const SKELETON_COUNT = 12

/** The grid while the albums are on their way. */
export const AlbumGridSkeleton = () => (
  <ul className={styles.grid} aria-hidden="true">
    {Array.from({ length: SKELETON_COUNT }, (_, index) => (
      <li key={index} className={styles.card}>
        <span className={styles.cover}>
          <Bone shape="fill" />
        </span>
        <Bone shape="text" width="most" />
        <Bone shape="text" width="short" />
      </li>
    ))}
  </ul>
)
