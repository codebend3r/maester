import {
  type MatchItemType,
  type MediaItem,
  type MediaSort,
  formatRuntime,
  mediaLabel,
  resolutionLabel,
  sortFact,
} from '@raven/core'
import { Link } from 'react-router-dom'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { api } from '@/lib/api'
import { cardLink, watchLink } from '@/lib/itemLinks'
import styles from '@/components/MediaCard/MediaCard.module.scss'

/**
 * One video in the grid. The picture plays it, handing the item to the
 * player through router state so playback starts without waiting on another
 * request. The title opens the page of the movie or episode the file is;
 * with no such page, the whole card is the one link to the player. A right
 * click on it, or the button in the corner, opens the card's menu. Sorted,
 * it shows the value its listing is sorted by above its facts.
 */
export const MediaCard = ({
  media,
  matchType = null,
  sort,
}: {
  media: MediaItem
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
  /** The order the listing is in, whose value the card shows. */
  sort?: MediaSort
}) => {
  const menu = useCardMenu({ media, matchType })
  const thumbnail = api.thumbnailUrl(media)
  const label = mediaLabel(media)
  const play = watchLink(media)
  const page = cardLink({ media, pages: true })
  const sorted = sort ? sortFact({ media, sort }) : null
  const facts = [
    formatRuntime(media.duration),
    resolutionLabel(media),
    media.hdr ? 'HDR' : null,
  ].filter((fact): fact is string => fact != null && fact !== sorted)

  const frame = (
    <span className={styles.frame}>
      {thumbnail ? (
        <img className={styles.thumbnail} src={thumbnail} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className={styles.placeholder} aria-hidden="true">
          {label.slice(0, 1)}
        </span>
      )}
      <ResumeBar media={media} className={styles.resume} />
    </span>
  )

  return (
    <li className={`${styles.card} ${menu.hostClass}`}>
      {page.state == null ? (
        <span className={styles.split}>
          <Link
            {...play}
            className={styles.picture}
            aria-label={`Play ${label}`}
            onContextMenu={menu.onContextMenu}
          >
            {frame}
          </Link>
          <Link
            {...page}
            className={`${styles.title} ${styles.titleLink}`}
            onContextMenu={menu.onContextMenu}
          >
            {label}
          </Link>
        </span>
      ) : (
        <Link {...play} className={styles.link} onContextMenu={menu.onContextMenu}>
          {frame}
          <span className={styles.title}>{label}</span>
        </Link>
      )}
      {sorted && <span className={styles.sorted}>{sorted}</span>}
      <span className={styles.facts}>
        <FavouriteMark media={media} />
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
        <PartlyWatched media={media} />
      </span>
      <PlaybackNote media={media} />
      {menu.menu}
    </li>
  )
}
