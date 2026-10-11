import {
  type MediaItem,
  type RatingSource,
  cardTitle,
  formatBitrate,
  formatBytes,
  formatRuntime,
  resolutionLabel,
  sortTitle,
} from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { MatchType } from '@/components/FixMatchDialog/FixMatchDialog'
import { Icon } from '@/components/Icon/Icon'
import { MENU_HOST, MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { ScoreChip } from '@/components/RatingChips/RatingChips'
import { SortHeader } from '@/components/SortHeader/SortHeader'
import { openPath } from '@/lib/itemLinks'
import { progressOf } from '@/lib/mediaProgress'
import { type SortColumn, useTableSort } from '@/lib/tableSort'
import styles from '@/components/MediaList/MediaList.module.scss'

const day = new Intl.DateTimeFormat(undefined, {
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
    <tr className={`${styles.row} ${MENU_HOST}`}>
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
      {movies &&
        RATING_COLUMNS.map((column) => {
          const rating = media.item?.ratings.find((entry) => entry.source === column.source)
          return (
            <td key={column.source} className={`${styles.number} ${styles.roomy}`}>
              {rating && <ScoreChip rating={rating} />}
            </td>
          )
        })}
      <td className={styles.number}>{formatRuntime(media.duration)}</td>
      <td className={styles.roomy}>{resolutionLabel(media)}</td>
      <td className={`${styles.number} ${styles.extra}`}>{formatBytes(media.size)}</td>
      <td className={`${styles.number} ${styles.extra}`}>{formatBitrate(media.bitrate)}</td>
      <td className={styles.extra}>{day.format(new Date(media.addedAt))}</td>
      <td className={styles.extra}>{day.format(new Date(media.changedAt))}</td>
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

const RATING_COLUMNS: readonly { source: RatingSource; label: string }[] = [
  { source: 'rottenTomatoes', label: 'RT' },
  { source: 'imdb', label: 'IMDb' },
  { source: 'metacritic', label: 'Metacritic' },
  { source: 'tmdb', label: 'TMDB' },
]

type Column =
  | 'title'
  | 'year'
  | 'rottenTomatoes'
  | 'imdb'
  | 'metacritic'
  | 'tmdb'
  | 'length'
  | 'resolution'
  | 'size'
  | 'bitrate'
  | 'added'
  | 'changed'

const score = (media: MediaItem, source: RatingSource): number | null =>
  media.item?.ratings.find((rating) => rating.source === source)?.value ?? null

const COLUMNS: Record<Column, SortColumn<MediaItem>> = {
  title: { value: (media) => sortTitle(cardTitle(media).title), first: 'asc' },
  year: { value: (media) => cardTitle(media).year, first: 'desc' },
  rottenTomatoes: { value: (media) => score(media, 'rottenTomatoes'), first: 'desc' },
  imdb: { value: (media) => score(media, 'imdb'), first: 'desc' },
  metacritic: { value: (media) => score(media, 'metacritic'), first: 'desc' },
  tmdb: { value: (media) => score(media, 'tmdb'), first: 'desc' },
  length: { value: (media) => media.duration, first: 'desc' },
  resolution: {
    value: (media) =>
      media.width != null && media.height != null ? media.width * media.height : null,
    first: 'desc',
  },
  size: { value: (media) => media.size, first: 'desc' },
  bitrate: { value: (media) => media.bitrate, first: 'desc' },
  added: { value: (media) => media.addedAt, first: 'desc' },
  changed: { value: (media) => media.changedAt, first: 'desc' },
}

/**
 * Every video as a row of facts, each column sortable with a click (the
 * library's own order comes back on the third). A narrow screen keeps
 * title, length and resolution; a phone drops resolution too, so titles
 * have room to read.
 */
export const MediaList = ({
  items,
  busy = false,
  movies = false,
  matchType = null,
}: {
  items: MediaItem[]
  busy?: boolean
  /** A Movies library: titles open the movie's page, and the year and ratings get columns. */
  movies?: boolean
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchType | null
}) => {
  const { sorted, toggle, ariaSort } = useTableSort({ rows: items, columns: COLUMNS })
  const header = (key: Column, label: string, className?: string) => (
    <SortHeader key={key} sort={ariaSort(key)} onToggle={() => toggle(key)} className={className}>
      {label}
    </SortHeader>
  )
  return (
    <table className={styles.table} aria-label="Videos" aria-busy={busy}>
      <thead>
        <tr>
          {header('title', 'Title')}
          {movies && header('year', 'Year', styles.number)}
          {movies &&
            RATING_COLUMNS.map((column) =>
              header(column.source, column.label, `${styles.number} ${styles.roomy}`),
            )}
          {header('length', 'Length', styles.number)}
          {header('resolution', 'Resolution', styles.roomy)}
          {header('size', 'Size', `${styles.number} ${styles.extra}`)}
          {header('bitrate', 'Bitrate', `${styles.number} ${styles.extra}`)}
          {header('added', 'Added', styles.extra)}
          {header('changed', 'Changed', styles.extra)}
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((item) => (
          <MediaRow key={item.id} media={item} movies={movies} matchType={matchType} />
        ))}
      </tbody>
    </table>
  )
}
