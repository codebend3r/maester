import {
  type MediaItem,
  cardTitle,
  codecLabel,
  formatBytes,
  formatRuntime,
  mediaLabel,
  resolutionLabel,
} from '@raven/core'
import { type MouseEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterFrame } from '@/components/PosterCard/PosterCard'
import { api } from '@/lib/api'
import { openPath } from '@/lib/itemLinks'
import { progressOf } from '@/lib/mediaProgress'
import styles from '@/components/MediaTiles/MediaTiles.module.scss'

/**
 * One video as a row with a small thumbnail, or a small poster in a Movies
 * library. The picture is a second way to the same place, so it stays out
 * of the tab order and the reading order; the title is the link. A right
 * click on either opens the row's menu.
 */
const MediaTile = ({
  media,
  note,
  posters,
}: {
  media: MediaItem
  note: string | null
  posters: boolean
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const openMenu = (event: MouseEvent) => {
    event.preventDefault()
    setMenuOpen(true)
  }
  const thumbnail = api.thumbnailUrl(media)
  const progress = progressOf(media)
  const to = posters ? openPath(media) : `/watch/${media.id}`
  const state = to === `/watch/${media.id}` ? { media } : undefined
  const { year } = cardTitle(media)
  const facts = [
    posters && year != null ? String(year) : null,
    posters && media.versions > 1 ? `${media.versions} versions` : null,
    formatRuntime(media.duration),
    resolutionLabel(media),
    media.hdr ? 'HDR' : null,
    media.videoCodec ? codecLabel(media.videoCodec) : null,
    formatBytes(media.size),
  ].filter((fact): fact is string => fact != null)

  return (
    <li className={posters ? `${styles.tile} ${styles.posterTile}` : styles.tile}>
      <Link
        to={to}
        state={state}
        className={posters ? styles.posterFrame : styles.frame}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={openMenu}
      >
        {posters ? (
          <PosterFrame media={media} />
        ) : thumbnail ? (
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
        {!posters && progress > 0 && (
          <span className={styles.resume}>
            <span className={styles.resumeFill} style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </Link>
      <div className={styles.body}>
        <Link to={to} state={state} className={styles.title} onContextMenu={openMenu}>
          {posters ? cardTitle(media).title : mediaLabel(media)}
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
        {posters && media.match === 'unmatched' && <span className={styles.note}>Not matched</span>}
        {note !== null && <span className={styles.note}>{note}</span>}
        <PlaybackNote media={media} />
      </div>
      <MediaMenu
        media={media}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        inline
        matchType={posters ? 'movie' : null}
      />
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
  posters = false,
}: {
  items: MediaItem[]
  busy?: boolean
  note?: (media: MediaItem) => string | null
  /** A Movies library's tiles: small posters, opening the movie's page. */
  posters?: boolean
}) => (
  <ul className={styles.tiles} aria-busy={busy}>
    {items.map((item) => (
      <MediaTile key={item.id} media={item} note={note ? note(item) : null} posters={posters} />
    ))}
  </ul>
)
