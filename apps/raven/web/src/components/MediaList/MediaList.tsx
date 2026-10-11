import {
  type MediaItem,
  cardTitle,
  formatBitrate,
  formatBytes,
  formatRuntime,
  resolutionLabel,
} from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { MatchType } from '@/components/FixMatchDialog/FixMatchDialog'
import { Icon } from '@/components/Icon/Icon'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { RatingChips } from '@/components/RatingChips/RatingChips'
import { openPath } from '@/lib/itemLinks'
import { progressOf } from '@/lib/mediaProgress'
import styles from '@/components/MediaList/MediaList.module.scss'

const added = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/**
 * One video as a table row; a right click on its title opens the row's
 * menu. In a Movies library the title opens the movie's page and a Year
 * column follows it.
 */
const MediaRow = ({
  media,
  movies,
  matchType,
}: {
  media: MediaItem
  movies: boolean
  matchType: MatchType | null
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const progress = progressOf(media)
  const to = movies ? openPath(media) : `/watch/${media.id}`
  const { title, year } = cardTitle(media)
  return (
    <tr className={styles.row}>
      <th scope="row">
        <div className={styles.titleCell}>
          <Link
            to={to}
            state={to === `/watch/${media.id}` ? { media } : undefined}
            className={styles.title}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenuOpen(true)
            }}
          >
            {title}
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
      {movies && <td className={styles.number}>{year ?? ''}</td>}
      {movies && (
        <td className={styles.roomy}>
          {media.item && <RatingChips ratings={media.item.ratings} />}
        </td>
      )}
      <td className={styles.number}>{formatRuntime(media.duration)}</td>
      <td className={styles.roomy}>{resolutionLabel(media)}</td>
      <td className={`${styles.number} ${styles.extra}`}>{formatBytes(media.size)}</td>
      <td className={`${styles.number} ${styles.extra}`}>{formatBitrate(media.bitrate)}</td>
      <td className={styles.extra}>{added.format(new Date(media.addedAt))}</td>
      <td className={styles.menuCell}>
        <MediaMenu
          media={media}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          inline
          matchType={matchType}
        />
      </td>
    </tr>
  )
}

/**
 * Every video as a row of facts. A narrow screen keeps title, length and
 * resolution; a phone drops resolution too, so titles have room to read.
 */
export const MediaList = ({
  items,
  busy = false,
  movies = false,
  matchType = null,
}: {
  items: MediaItem[]
  busy?: boolean
  /** A Movies library: titles open the movie's page, and the year gets a column. */
  movies?: boolean
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchType | null
}) => (
  <table className={styles.table} aria-label="Videos" aria-busy={busy}>
    <thead>
      <tr>
        <th scope="col">Title</th>
        {movies && (
          <th scope="col" className={styles.number}>
            Year
          </th>
        )}
        {movies && (
          <th scope="col" className={styles.roomy}>
            Ratings
          </th>
        )}
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
        <MediaRow key={item.id} media={item} movies={movies} matchType={matchType} />
      ))}
    </tbody>
  </table>
)
