import { type MediaItem, formatRuntime, resolutionLabel } from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { api } from '@/lib/api'
import { progressOf } from '@/lib/mediaProgress'
import styles from '@/components/MediaCard/MediaCard.module.scss'

/**
 * One video in the grid. The whole card is the link, and it hands the item
 * to the player through router state so playback starts without waiting on
 * another request. A right click on it, or the button in the corner, opens
 * the card's menu.
 */
export const MediaCard = ({ media }: { media: MediaItem }) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const thumbnail = api.thumbnailUrl(media)
  const progress = progressOf(media)
  const facts = [
    formatRuntime(media.duration),
    resolutionLabel(media),
    media.hdr ? 'HDR' : null,
  ].filter((fact): fact is string => fact != null)

  return (
    <li className={styles.card}>
      <Link
        to={`/watch/${media.id}`}
        state={{ media }}
        className={styles.link}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
      >
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
              {media.title.slice(0, 1)}
            </span>
          )}
          {progress > 0 && (
            <span className={styles.resume} aria-hidden="true">
              <span className={styles.resumeFill} style={{ width: `${progress * 100}%` }} />
            </span>
          )}
        </span>
        <span className={styles.title}>{media.title}</span>
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
        {progress > 0 && <span className="visually-hidden">Partly watched</span>}
      </span>
      <PlaybackNote media={media} />
      <MediaMenu media={media} open={menuOpen} onOpenChange={setMenuOpen} />
    </li>
  )
}
