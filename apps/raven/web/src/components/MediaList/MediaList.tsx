import {
  type MatchItemType,
  type MediaItem,
  RATING_SOURCES,
  type RatingSource,
  type SortColumn,
  cardLink,
  cardTitle,
  formatBitrate,
  formatBytes,
  formatRuntime,
  mediaEntryKey,
  resolutionLabel,
  sortTitle,
} from '@raven/core'
import { RatingBadge } from '@/components/RatingPanel/RatingPanel'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { SortHeader } from '@/components/SortHeader/SortHeader'
import { WatchedMark } from '@/components/WatchedMark/WatchedMark'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { useTableSort } from '@/lib/useTableSort'
import { useSelectable } from '@/lib/useSelectable'
import styles from '@/components/MediaList/MediaList.module.scss'

const day = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/**
 * One video as a table row, its small poster or frame grab before its
 * title; a right click on either opens the row's menu. The picture is a
 * second way to the same place, so it stays out of the tab order and the
 * reading order. In a Movies library the title opens the movie's page and a
 * Year column follows it.
 */
const MediaRow = ({
  media,
  movies,
  matchType,
}: {
  media: MediaItem
  movies: boolean
  matchType: MatchItemType | null
}) => {
  const menu = useCardMenu({ media, matchType, inline: true })
  const { title, year } = cardTitle(media)
  const select = useSelectable({ key: mediaEntryKey(media), title })
  const link = cardLink({ media, pages: movies })
  const thumbnail = api.thumbnailUrl(media)
  return (
    <tr className={menu.hostClass} data-entry={mediaEntryKey(media)} {...select.rootProps}>
      <th scope="row" className={styles.titleHeader}>
        <div className={styles.titleCell}>
          <SelectCheckbox select={select} className={styles.select} />
          <CardLink
            {...link}
            className={movies ? styles.poster : styles.frame}
            tabIndex={-1}
            aria-hidden="true"
            onContextMenu={menu.onContextMenu}
          >
            {movies ? (
              <PosterImage media={media} sizes={POSTER_SIZES.list} />
            ) : (
              thumbnail && (
                <img
                  className={styles.thumbnail}
                  src={thumbnail}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )
            )}
          </CardLink>
          <CardLink
            {...link}
            className={styles.title}
            tabIndex={select.linkTabIndex}
            onContextMenu={menu.onContextMenu}
          >
            {title}
          </CardLink>
          <span className={styles.mark}>
            <WatchedMark watched={media.watched} />
            <FavouriteMark media={media} />
          </span>
          <ResumeBar media={media} tone="inline" className={styles.resume} />
          <PartlyWatched media={media} />
        </div>
      </th>
      {movies && <td className={styles.number}>{year ?? ''}</td>}
      {movies &&
        RATING_COLUMNS.map((column) => {
          const rating = media.item?.ratings.find((entry) => entry.source === column.source)
          return (
            <td key={column.source} className={`${styles.number} ${styles.roomy}`}>
              {rating && <RatingBadge rating={rating} />}
            </td>
          )
        })}
      <td className={movies ? `${styles.number} ${styles.spare}` : styles.number}>
        {formatRuntime(media.duration)}
      </td>
      <td className={styles.roomy}>{resolutionLabel(media)}</td>
      <td className={`${styles.number} ${styles.extra}`}>{formatBytes(media.size)}</td>
      <td className={`${styles.number} ${styles.extra}`}>{formatBitrate(media.bitrate)}</td>
      <td className={styles.extra}>{day.format(new Date(media.addedAt))}</td>
      <td className={styles.extra}>{day.format(new Date(media.changedAt))}</td>
      <td className={styles.menuCell}>{menu.menu}</td>
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

const score = ({ media, source }: { media: MediaItem; source: RatingSource }): number | null =>
  media.item?.ratings.find((rating) => rating.source === source)?.value ?? null

const COLUMNS: Record<Column, SortColumn<MediaItem>> = {
  title: { value: (media) => sortTitle(cardTitle(media).title), first: 'asc' },
  year: { value: (media) => cardTitle(media).year, first: 'desc' },
  rottenTomatoes: {
    value: (media) => score({ media, source: RATING_SOURCES.rottenTomatoes }),
    first: 'desc',
  },
  imdb: { value: (media) => score({ media, source: RATING_SOURCES.imdb }), first: 'desc' },
  metacritic: {
    value: (media) => score({ media, source: RATING_SOURCES.metacritic }),
    first: 'desc',
  },
  tmdb: { value: (media) => score({ media, source: RATING_SOURCES.tmdb }), first: 'desc' },
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
 * library's own order comes back on the third). The columns go by the room
 * the table has: a narrow one keeps title, length and resolution, then
 * drops resolution too, so titles have room to read.
 */
export const MediaList = ({
  items,
  movies = false,
  matchType = null,
}: {
  items: MediaItem[]
  /** A Movies library: titles open the movie's page, and the year and ratings get columns. */
  movies?: boolean
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
}) => {
  const { sorted, toggle, ariaSort } = useTableSort({ rows: items, columns: COLUMNS })
  const header = ({
    key,
    label,
    className,
  }: {
    key: Column
    label: string
    className?: string
  }) => (
    <SortHeader key={key} sort={ariaSort(key)} onToggle={() => toggle(key)} className={className}>
      {label}
    </SortHeader>
  )
  return (
    <div className={styles.room}>
      <table
        className={movies ? `${styles.table} ${styles.movies}` : styles.table}
        aria-label="Videos"
      >
        <thead>
          <tr>
            {header({ key: 'title', label: 'Title' })}
            {movies && header({ key: 'year', label: 'Year', className: styles.number })}
            {movies &&
              RATING_COLUMNS.map((column) =>
                header({
                  key: column.source,
                  label: column.label,
                  className: `${styles.number} ${styles.roomy}`,
                }),
              )}
            {header({
              key: 'length',
              label: 'Length',
              className: movies ? `${styles.number} ${styles.spare}` : styles.number,
            })}
            {header({ key: 'resolution', label: 'Resolution', className: styles.roomy })}
            {header({ key: 'size', label: 'Size', className: `${styles.number} ${styles.extra}` })}
            {header({
              key: 'bitrate',
              label: 'Bitrate',
              className: `${styles.number} ${styles.extra}`,
            })}
            {header({ key: 'added', label: 'Added', className: styles.extra })}
            {header({ key: 'changed', label: 'Changed', className: styles.extra })}
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
    </div>
  )
}
