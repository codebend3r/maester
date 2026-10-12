import {
  type ItemSummary,
  type MatchItemType,
  type MediaItem,
  type MediaSort,
  type RatingSource,
  cardTitle,
  formatRuntime,
  pickScore,
  sortFact,
} from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { Icon } from '@/components/Icon/Icon'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { ScoreChip } from '@/components/RatingChips/RatingChips'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { api } from '@/lib/api'
import { cardLink, watchLink } from '@/lib/itemLinks'
import styles from '@/components/PosterCard/PosterCard.module.scss'

/**
 * The picture a poster card shows: the poster, else the frame grab cropped
 * to 2:3, else the title's first letter. A poster that fails to load falls
 * back the same way. The poster is the video's own item's unless `poster`
 * names another, as an episode shows its season's.
 */
export const PosterFrame = ({
  media,
  poster: stand = media.item,
}: {
  media: MediaItem
  poster?: ItemSummary | null
}) => {
  const poster = stand
    ? api.itemImageUrl({ id: stand.id, kind: 'poster', version: stand.posterVersion })
    : null
  const thumbnail = api.thumbnailUrl(media)
  const [failed, setFailed] = useState<ReadonlyArray<string>>([])
  const source = [poster, thumbnail].find(
    (url): url is string => url != null && !failed.includes(url),
  )
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
      <ResumeBar media={media} className={styles.resume} />
    </span>
  )
}

/**
 * A movie as a poster, its title and year beneath. A matched card opens the
 * movie's page and its play button plays at once; anything else opens the
 * player, as a frame-grab card does. A right click opens the card's menu.
 * Sorted, it shows the value its listing is sorted by above its facts.
 */
export const PosterCard = ({
  media,
  matchType = null,
  ratingsSource = 'tmdb',
  sort,
  poster,
}: {
  media: MediaItem
  /** The item whose poster the card shows, when not the video's own: an episode's season. */
  poster?: ItemSummary | null
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
  /** Whose score the card shows, from the library's settings. */
  ratingsSource?: RatingSource
  /** The order the listing is in, whose value the card shows. */
  sort?: MediaSort
}) => {
  const menu = useCardMenu({ media, matchType })
  const { title, year } = cardTitle(media)
  const score = media.item
    ? pickScore({ ratings: media.item.ratings, source: ratingsSource })
    : null
  const link = cardLink({ media, pages: true })
  const hasPage = link.state == null
  const sorted = sort ? sortFact({ media, sort }) : null
  const facts = [
    year == null ? null : String(year),
    media.versions > 1 ? `${media.versions} versions` : null,
    year == null && media.versions === 1 ? formatRuntime(media.duration) : null,
  ].filter((fact): fact is string => fact != null && fact !== sorted)

  return (
    <li className={`${styles.card} ${menu.hostClass}`}>
      <Link
        {...link}
        className={styles.picture}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={menu.onContextMenu}
      >
        <PosterFrame media={media} poster={poster} />
      </Link>
      {hasPage && (
        <span className={styles.overlay}>
          <Link {...watchLink(media)} className={styles.play} aria-label={`Play ${title}`}>
            <Icon name="play" size={18} />
          </Link>
        </span>
      )}
      <Link {...link} className={styles.title} onContextMenu={menu.onContextMenu}>
        {title}
      </Link>
      {sorted && <span className={styles.sorted}>{sorted}</span>}
      <span className={styles.facts}>
        <FavouriteMark media={media} />
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
        {score && <ScoreChip rating={score} />}
        {media.match === 'unmatched' && <span>Not matched</span>}
        <PartlyWatched media={media} />
      </span>
      <PlaybackNote media={media} place="card" />
      {menu.menu}
    </li>
  )
}
