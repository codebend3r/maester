import {
  ITEM_TYPES,
  type MediaItem,
  type PosterEntry,
  cardTitle,
  episodeCode,
  formatRuntime,
  mediaLabel,
} from '@raven/core'
import { Button, Icon } from '@raven/ui'
import { useId, useState } from 'react'
import { CardLink } from '@/components/CardLink/CardLink'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { api } from '@/lib/api'
import { cardLink, watchLink } from '@/lib/itemLinks'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/pages/HomePage/ContinueWatching.module.scss'

/** What a tile names: the show, with the episode under it, else the movie and its year. */
export const tileWords = (media: MediaItem): { title: string; line: string | null } => {
  const { item } = media
  if (item?.type === ITEM_TYPES.episode && item.show) {
    const line = [episodeCode(item), item.title]
      .filter((part): part is string => part != null && part !== '')
      .join(' · ')
    return { title: item.show.title, line: line === '' ? null : line }
  }
  const { title, year } = cardTitle(media)
  return { title, line: year == null ? null : String(year) }
}

/** "23m left", "1h 12m left"; null until the video's length is known. */
export const timeLeft = (media: MediaItem): string | null => {
  if (media.duration == null) return null
  const left = formatRuntime(media.duration - media.position)
  return left == null ? null : `${left} left`
}

/**
 * The picture a tile is tinted with, blurred past knowing: the poster at its
 * narrowest width, which `sizes` asks the browser for, else the frame grab
 * the tile already shows.
 */
const Tint = ({ entry: { media, poster } }: { entry: PosterEntry }) => {
  const srcSet = poster ? api.posterSrcSet({ id: poster.id, version: poster.posterVersion }) : null
  const thumbnail = api.thumbnailUrl(media)
  if (srcSet) {
    return (
      <img
        className={styles.tint}
        srcSet={srcSet}
        sizes="1px"
        alt=""
        loading="lazy"
        decoding="async"
      />
    )
  }
  if (!thumbnail) return null
  return <img className={styles.tint} src={thumbnail} alt="" loading="lazy" decoding="async" />
}

/**
 * A video in progress as a wide tile tinted from its artwork: its poster, or
 * a frame grab where it has none, its name, the episode or year, how far in
 * it is and how long is left. The tile resumes it; its name opens its page,
 * where it has one. A right click opens the card's menu.
 */
const ContinueTile = ({ entry }: { entry: PosterEntry }) => {
  const { media, poster } = entry
  const menu = useCardMenu({ media, matchType: null })
  const label = mediaLabel(media)
  const { title, line } = tileWords(media)
  const left = timeLeft(media)
  const page = cardLink({ media, pages: true })
  const hasPage = page.state == null
  const hasPoster = poster?.posterVersion != null

  return (
    <li className={`${styles.tile} ${menu.hostClass}`}>
      <CardLink
        {...watchLink({ media })}
        className={styles.play}
        aria-label={`Play ${label}`}
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
        {hasPage ? (
          <CardLink
            {...page}
            className={`${styles.title} ${styles.link}`}
            aria-label={label}
            onContextMenu={menu.onContextMenu}
          >
            {title}
          </CardLink>
        ) : (
          <span className={styles.title}>{title}</span>
        )}
        {line && <span className={styles.line}>{line}</span>}
        {left && (
          <span className={styles.progress}>
            <ResumeBar media={media} className={styles.bar} />
            <span className={styles.left}>{left}</span>
          </span>
        )}
      </span>
      <Tint entry={entry} />
      {menu.menu}
    </li>
  )
}

/** Three rows of two: as many as fit before the library rows without burying them. */
const FIRST_TILES = 6

/**
 * Every video in progress, the most recently watched first, as wide tiles
 * two across. Past the first three rows the rest wait behind Show all.
 */
export const ContinueWatching = ({ entries }: { entries: PosterEntry[] }) => {
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
              {isAll ? 'Show fewer' : `Show all ${entries.length}`}
            </Button>
          )
        }
      >
        Continue watching
      </SectionHeading>
      <ul id={`${id}-tiles`} className={styles.tiles}>
        {shown.map((entry) => (
          <ContinueTile key={entry.media.id} entry={entry} />
        ))}
      </ul>
    </section>
  )
}
