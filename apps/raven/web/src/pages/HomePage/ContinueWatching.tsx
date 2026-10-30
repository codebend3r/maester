import {
  type MediaItem,
  type PosterEntry,
  cardLink,
  formatRuntime,
  mediaLabel,
  resolutionLabel,
  tileWords,
  watchLink,
} from '@raven/core'
import { Button, Icon } from '@raven/ui'
import { type ComponentType, useId, useState } from 'react'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { CardLink } from '@/components/CardLink/CardLink'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { HOME_COPY } from '@/pages/HomePage/copy'
import styles from '@/pages/HomePage/ContinueWatching.module.scss'

/** "23m left", "1h 12m left"; null until the video's length is known. */
export const timeLeft = (media: MediaItem): string | null => {
  if (media.duration == null) return null
  const left = formatRuntime(media.duration - media.position)
  return left == null ? null : HOME_COPY.timeLeft(left)
}

const TINT_KINDS = { poster: 'poster', frame: 'frame', none: 'none' } as const

type PosterTintProps = { srcSet: string }

const PosterTint = ({ srcSet }: PosterTintProps) => (
  <img className={styles.tint} srcSet={srcSet} sizes="1px" alt="" loading="lazy" decoding="async" />
)

type FrameTintProps = { thumbnail: string }

const FrameTint = ({ thumbnail }: FrameTintProps) => (
  <img className={styles.tint} src={thumbnail} alt="" loading="lazy" decoding="async" />
)

const NoTint = () => null

type TintViewProps = {
  [TINT_KINDS.poster]: PosterTintProps
  [TINT_KINDS.frame]: FrameTintProps
  [TINT_KINDS.none]: Record<never, never>
}

const TINTS = {
  [TINT_KINDS.poster]: PosterTint,
  [TINT_KINDS.frame]: FrameTint,
  [TINT_KINDS.none]: NoTint,
} as const satisfies ViewsOf<TintViewProps>

type TintProps = { entry: PosterEntry }

/** The poster's sources where it has one, else the frame grab, else nothing. */
type TintViewOfProps = TintProps

const tintViewOf = ({ entry: { media, poster } }: TintViewOfProps): ViewOf<TintViewProps> => {
  const srcSet = poster ? api.posterSrcSet({ id: poster.id, version: poster.posterVersion }) : null
  if (srcSet) return { key: TINT_KINDS.poster, props: { srcSet } }
  const thumbnail = api.thumbnailUrl(media)
  if (thumbnail) return { key: TINT_KINDS.frame, props: { thumbnail } }
  return { key: TINT_KINDS.none, props: {} }
}

/**
 * The picture a tile is tinted with, blurred past knowing: the poster at its
 * narrowest width, which `sizes` asks the browser for, else the frame grab
 * the tile already shows.
 */
const Tint = ({ entry }: TintProps) => (
  <KeyedView<TintViewProps> views={TINTS} view={tintViewOf({ entry })} />
)

const TITLE_KINDS = { linked: 'linked', plain: 'plain' } as const
type TitleKind = (typeof TITLE_KINDS)[keyof typeof TITLE_KINDS]

type TileTitleProps = {
  page: ReturnType<typeof cardLink>
  title: string
  label: string
  onContextMenu: ReturnType<typeof useCardMenu>['onContextMenu']
}

type LinkedTitleProps = TileTitleProps

const LinkedTitle = ({ page, title, label, onContextMenu }: LinkedTitleProps) => (
  <CardLink
    {...page}
    className={`${styles.title} ${styles.link}`}
    aria-label={label}
    onContextMenu={onContextMenu}
  >
    {title}
  </CardLink>
)

type PlainTitleProps = TileTitleProps

const PlainTitle = ({ title }: PlainTitleProps) => <span className={styles.title}>{title}</span>

const TILE_TITLES = {
  [TITLE_KINDS.linked]: LinkedTitle,
  [TITLE_KINDS.plain]: PlainTitle,
} as const satisfies Record<TitleKind, ComponentType<TileTitleProps>>

type ContinueTileProps = { entry: PosterEntry }

/**
 * A video in progress as a wide tile tinted from its artwork: its poster, or
 * a frame grab where it has none, its name, the episode or year, how far in
 * it is and how long is left. The tile resumes it; its name opens its page,
 * where it has one. A right click opens the card's menu.
 */
const ContinueTile = ({ entry }: ContinueTileProps) => {
  const { media, poster } = entry
  const menu = useCardMenu({ media, matchType: null, beside: true })
  const label = mediaLabel(media)
  const { title, line } = tileWords(media)
  const left = timeLeft(media)
  const page = cardLink({ media, hasPages: true })
  const TileTitle = TILE_TITLES[page.state == null ? TITLE_KINDS.linked : TITLE_KINDS.plain]
  const hasPoster = poster?.posterVersion != null
  const resolution = resolutionLabel(media)

  return (
    <li className={`${styles.tile} ${menu.hostClass}`}>
      <CardLink
        {...watchLink({ media })}
        className={styles.play}
        aria-label={HOME_COPY.playTitle(label)}
        onContextMenu={menu.onContextMenu}
      >
        <span className={hasPoster ? `${styles.frame} ${styles.poster}` : styles.frame}>
          <span className={styles.picture}>
            <PosterImage media={media} poster={poster} sizes={POSTER_SIZES.showTile} />
          </span>
          <span className={styles.mark}>
            <Icon name="play" size={20} />
          </span>
        </span>
      </CardLink>
      <span className={styles.copy}>
        <TileTitle page={page} title={title} label={label} onContextMenu={menu.onContextMenu} />
        {(line || resolution != null) && (
          <span className={styles.line}>
            {line && <span>{line}</span>}
            <ResolutionChip resolution={resolution} />
          </span>
        )}
        {left && (
          <span className={styles.progress}>
            <ResumeBar media={media} className={styles.bar} />
            <span className={styles.left}>{left}</span>
          </span>
        )}
      </span>
      <span className={styles.backdrop}>
        <Tint entry={entry} />
      </span>
      {menu.menu}
    </li>
  )
}

/** Three rows of two: as many as fit before the library rows without burying them. */
const FIRST_TILES = 6

type ContinueWatchingProps = { entries: PosterEntry[] }

/**
 * Every video in progress, the most recently watched first, as wide tiles
 * two across. Past the first three rows the rest wait behind Show all.
 */
export const ContinueWatching = ({ entries }: ContinueWatchingProps) => {
  const id = useId()
  const [isAll, setAll] = useState(false)
  const hasMore = entries.length > FIRST_TILES
  const shown = isAll ? entries : entries.slice(0, FIRST_TILES)
  return (
    <section className={styles.section} aria-labelledby={id}>
      <SectionHeading
        id={id}
        aside={
          hasMore && (
            <Button
              tone="ghost"
              aria-expanded={isAll}
              aria-controls={`${id}-tiles`}
              onClick={() => setAll((now) => !now)}
            >
              {isAll ? HOME_COPY.showFewer : HOME_COPY.showAll(entries.length)}
            </Button>
          )
        }
      >
        {HOME_COPY.continueWatching}
      </SectionHeading>
      <ul id={`${id}-tiles`} className={styles.tiles}>
        {shown.map((entry) => (
          <ContinueTile key={entry.media.id} entry={entry} />
        ))}
      </ul>
    </section>
  )
}
