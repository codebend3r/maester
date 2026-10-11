import {
  type MatchItemType,
  type MediaItem,
  formatRuntime,
  mediaLabel,
  resolutionLabel,
} from '@raven/core'
import { Link } from 'react-router-dom'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { api } from '@/lib/api'
import { watchLink } from '@/lib/itemLinks'
import styles from '@/components/MediaCard/MediaCard.module.scss'

/**
 * One video in the grid. The whole card is the link, and it hands the item
 * to the player through router state so playback starts without waiting on
 * another request. A right click on it, or the button in the corner, opens
 * the card's menu.
 */
export const MediaCard = ({
  media,
  matchType = null,
}: {
  media: MediaItem
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
}) => {
  const menu = useCardMenu({ media, matchType })
  const thumbnail = api.thumbnailUrl(media)
  const facts = [
    formatRuntime(media.duration),
    resolutionLabel(media),
    media.hdr ? 'HDR' : null,
  ].filter((fact): fact is string => fact != null)

  return (
    <li className={`${styles.card} ${menu.hostClass}`}>
      <Link {...watchLink(media)} className={styles.link} onContextMenu={menu.onContextMenu}>
        <span className={styles.frame}>
          {thumbnail ? (
            <img
              className={styles.thumbnail}
              src={thumbnail}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className={styles.placeholder} aria-hidden="true">
              {mediaLabel(media).slice(0, 1)}
            </span>
          )}
          <ResumeBar media={media} className={styles.resume} />
        </span>
        <span className={styles.title}>{mediaLabel(media)}</span>
      </Link>
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
