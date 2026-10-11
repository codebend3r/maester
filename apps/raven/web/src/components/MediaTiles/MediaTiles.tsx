import {
  type MediaItem,
  codecLabel,
  formatBytes,
  formatRuntime,
  resolutionLabel,
} from '@raven/core'
import { type MouseEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { api } from '@/lib/api'
import { progressOf } from '@/lib/mediaProgress'
import styles from '@/components/MediaTiles/MediaTiles.module.scss'

/**
 * One video as a row with a small thumbnail. The thumbnail is a second way
 * to the same place, so it stays out of the tab order and the reading order;
 * the title is the link. A right click on either opens the row's menu.
 */
const MediaTile = ({ media, note }: { media: MediaItem; note: string | null }) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const openMenu = (event: MouseEvent) => {
    event.preventDefault()
    setMenuOpen(true)
  }
  const thumbnail = api.thumbnailUrl(media)
  const progress = progressOf(media)
  const facts = [
    formatRuntime(media.duration),
    resolutionLabel(media),
    media.hdr ? 'HDR' : null,
    media.videoCodec ? codecLabel(media.videoCodec) : null,
    formatBytes(media.size),
  ].filter((fact): fact is string => fact != null)

  return (
    <li className={styles.tile}>
      <Link
        to={`/watch/${media.id}`}
        state={{ media }}
        className={styles.frame}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={openMenu}
      >
        {thumbnail ? (
          <img
            className={styles.thumbnail}
            src={thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className={styles.placeholder}>{media.title.slice(0, 1)}</span>
        )}
        {progress > 0 && (
          <span className={styles.resume}>
            <span className={styles.resumeFill} style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </Link>
      <div className={styles.body}>
        <Link
          to={`/watch/${media.id}`}
          state={{ media }}
          className={styles.title}
          onContextMenu={openMenu}
        >
          {media.title}
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
        {media.folder !== '' && <span className={styles.folder}>{media.folder}</span>}
        {note !== null && <span className={styles.note}>{note}</span>}
        <PlaybackNote media={media} />
      </div>
      <MediaMenu media={media} open={menuOpen} onOpenChange={setMenuOpen} inline />
    </li>
  )
}

/**
 * Every video as a taller row with a small thumbnail beside its facts.
 * `note` adds a line of the caller's own under a video, as the history does.
 */
export const MediaTiles = ({
  items,
  busy = false,
  note,
}: {
  items: MediaItem[]
  busy?: boolean
  note?: (media: MediaItem) => string | null
}) => (
  <ul className={styles.tiles} aria-busy={busy}>
    {items.map((item) => (
      <MediaTile key={item.id} media={item} note={note ? note(item) : null} />
    ))}
  </ul>
)
