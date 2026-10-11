import { type MediaItem, type ShownRatings, cardTitle, formatRuntime, pickScore } from '@raven/core'
import { type MouseEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { MENU_HOST, MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { ScoreChip } from '@/components/RatingChips/RatingChips'
import { api } from '@/lib/api'
import { openPath } from '@/lib/itemLinks'
import { progressOf } from '@/lib/mediaProgress'
import styles from '@/components/PosterCard/PosterCard.module.scss'

/**
 * The picture a poster card shows: the poster, else the frame grab cropped
 * to 2:3, else the title's first letter. A poster that fails to load falls
 * back the same way.
 */
export const PosterFrame = ({ media }: { media: MediaItem }) => {
  const poster = media.item
    ? api.itemImageUrl({ id: media.item.id, kind: 'poster', version: media.item.posterVersion })
    : null
  const thumbnail = api.thumbnailUrl(media)
  const [failed, setFailed] = useState<ReadonlyArray<string>>([])
  const source = [poster, thumbnail].find(
    (url): url is string => url != null && !failed.includes(url),
  )
  const progress = progressOf(media)

  return (
    <span className={styles.frame}>
      {source ? (
        <img
          key={source}
          className={styles.image}
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed((current) => [...current, source])}
        />
      ) : (
        <span className={styles.placeholder} aria-hidden="true">
          {cardTitle(media).title.slice(0, 1)}
        </span>
      )}
      {progress > 0 && (
        <span className={styles.resume} aria-hidden="true">
          <span className={styles.resumeFill} style={{ width: `${progress * 100}%` }} />
        </span>
      )}
    </span>
  )
}

/**
 * A movie as a poster, its title and year beneath. A matched card opens the
 * movie's page and its play button plays at once; anything else opens the
 * player, as a frame-grab card does. A right click opens the card's menu.
 */
export const PosterCard = ({
  media,
  ratingsSource = 'tmdb',
}: {
  media: MediaItem
  /** Whose score the card shows, from the library's settings. */
  ratingsSource?: ShownRatings
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const openMenu = (event: MouseEvent) => {
    event.preventDefault()
    setMenuOpen(true)
  }
  const { title, year } = cardTitle(media)
  const score = media.item
    ? pickScore({ ratings: media.item.ratings, source: ratingsSource })
    : null
  const to = openPath(media)
  const hasPage = to !== `/watch/${media.id}`
  const progress = progressOf(media)
  const facts = [
    year == null ? null : String(year),
    media.versions > 1 ? `${media.versions} versions` : null,
    year == null && media.versions === 1 ? formatRuntime(media.duration) : null,
  ].filter((fact): fact is string => fact != null)

  return (
    <li className={`${styles.card} ${MENU_HOST}`}>
      <Link
        to={to}
        state={hasPage ? undefined : { media }}
        className={styles.picture}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={openMenu}
      >
        <PosterFrame media={media} />
      </Link>
      {hasPage && (
        <span className={styles.overlay}>
          <Link
            to={`/watch/${media.id}`}
            state={{ media }}
            className={styles.play}
            aria-label={`Play ${title}`}
          >
            <Icon name="play" size={18} />
          </Link>
        </span>
      )}
      <Link
        to={to}
        state={hasPage ? undefined : { media }}
        className={styles.title}
        onContextMenu={openMenu}
      >
        {title}
      </Link>
      <span className={styles.facts}>
        {media.favourite && (
          <span className={styles.favourite}>
            <Icon name="heart" size={14} />
            <span className="visually-hidden">Favourite</span>
          </span>
        )}
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
        {score && <ScoreChip rating={score} />}
        {media.match === 'unmatched' && <span>Not matched</span>}
        {progress > 0 && <span className="visually-hidden">Partly watched</span>}
      </span>
      <PlaybackNote media={media} />
      <MediaMenu media={media} open={menuOpen} onOpenChange={setMenuOpen} matchType="movie" />
    </li>
  )
}
