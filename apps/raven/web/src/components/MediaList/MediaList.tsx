import {
  type MediaItem,
  formatBitrate,
  formatBytes,
  formatRuntime,
  resolutionLabel,
} from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { progressOf } from '@/lib/mediaProgress'
import styles from '@/components/MediaList/MediaList.module.scss'

const added = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** One video as a table row; a right click on its title opens the row's menu. */
const MediaRow = ({ media }: { media: MediaItem }) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const progress = progressOf(media)
  return (
    <tr className={styles.row}>
      <th scope="row">
        <div className={styles.titleCell}>
          <Link
            to={`/watch/${media.id}`}
            state={{ media }}
            className={styles.title}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenuOpen(true)
            }}
          >
            {media.title}
          </Link>
          {media.favourite && (
            <span className={styles.favourite}>
              <Icon name="heart" size={14} />
              <span className="visually-hidden">Favourite</span>
            </span>
          )}
          {progress > 0 && (
            <span className={styles.resume} aria-hidden="true">
              <span className={styles.resumeFill} style={{ width: `${progress * 100}%` }} />
            </span>
          )}
          {progress > 0 && <span className="visually-hidden">Partly watched</span>}
        </div>
      </th>
      <td className={styles.number}>{formatRuntime(media.duration)}</td>
      <td className={styles.roomy}>{resolutionLabel(media)}</td>
      <td className={`${styles.number} ${styles.extra}`}>{formatBytes(media.size)}</td>
      <td className={`${styles.number} ${styles.extra}`}>{formatBitrate(media.bitrate)}</td>
      <td className={styles.extra}>{added.format(new Date(media.addedAt))}</td>
      <td className={styles.menuCell}>
        <MediaMenu media={media} open={menuOpen} onOpenChange={setMenuOpen} inline />
      </td>
    </tr>
  )
}

/**
 * Every video as a row of facts. A narrow screen keeps title, length and
 * resolution; a phone drops resolution too, so titles have room to read.
 */
export const MediaList = ({ items, busy = false }: { items: MediaItem[]; busy?: boolean }) => (
  <table className={styles.table} aria-label="Videos" aria-busy={busy}>
    <thead>
      <tr>
        <th scope="col">Title</th>
        <th scope="col" className={styles.number}>
          Length
        </th>
        <th scope="col" className={styles.roomy}>
          Resolution
        </th>
        <th scope="col" className={`${styles.number} ${styles.extra}`}>
          Size
        </th>
        <th scope="col" className={`${styles.number} ${styles.extra}`}>
          Bitrate
        </th>
        <th scope="col" className={styles.extra}>
          Added
        </th>
        <th scope="col">
          <span className="visually-hidden">Actions</span>
        </th>
      </tr>
    </thead>
    <tbody>
      {items.map((item) => (
        <MediaRow key={item.id} media={item} />
      ))}
    </tbody>
  </table>
)
