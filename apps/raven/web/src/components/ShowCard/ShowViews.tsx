import {
  type MediaSort,
  RATING_SOURCES,
  type RatingSource,
  type ShowEntry,
  WATCHED_STATES,
  episodeCode,
  showSortFact,
  sortTitle,
  watchedStateOf,
} from '@raven/core'
import { useState } from 'react'
import { CardLink } from '@/components/CardLink/CardLink'
import { Icon } from '@raven/ui'
import { ScoreChip } from '@/components/RatingChips/RatingChips'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { SortHeader } from '@/components/SortHeader/SortHeader'
import { WatchedCount } from '@/components/WatchedCount/WatchedCount'
import { showYears } from '@/lib/itemLinks'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import { type SortColumn, useTableSort } from '@/lib/tableSort'
import { showEntryKey } from '@/lib/entryKeys'
import { useSelectable } from '@/lib/useSelectable'
import styles from '@/components/ShowCard/ShowViews.module.scss'

const episodesLabel = (entry: ShowEntry): string =>
  `${entry.episodes} ${entry.episodes === 1 ? 'episode' : 'episodes'}`

/** The play button a show's row carries: its first episode not yet watched, when there is one. */
const NextPlay = ({ entry }: { entry: ShowEntry }) => {
  const { show, next } = entry
  if (!next) return null
  const code = next.item ? episodeCode(next.item) : null
  return (
    <CardLink
      to={`/watch/${next.id}`}
      state={{ media: next }}
      className={styles.play}
      aria-label={code ? `Play ${show.title} ${code}` : `Play ${show.title}`}
    >
      <Icon name="play" size={16} />
    </CardLink>
  )
}

/**
 * A show's small poster, or its initial; a second way to the page, so out
 * of the tab order. A list's row shows it smaller than a tile.
 */
const SmallPoster = ({ entry, inRow = false }: { entry: ShowEntry; inRow?: boolean }) => {
  const { show } = entry
  const poster = posterSources({
    item: show,
    sizes: inRow ? POSTER_SIZES.list : POSTER_SIZES.showTile,
  })
  const [failed, setFailed] = useState(false)
  return (
    <CardLink
      to={`/shows/${show.id}`}
      className={inRow ? `${styles.frame} ${styles.rowFrame}` : styles.frame}
      tabIndex={-1}
      aria-hidden="true"
    >
      {poster && !failed ? (
        <img
          className={styles.image}
          {...poster}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.placeholder}>{show.title.slice(0, 1)}</span>
      )}
    </CardLink>
  )
}

const RATING_COLUMNS: readonly { source: RatingSource; label: string }[] = [
  { source: 'rottenTomatoes', label: 'RT' },
  { source: 'imdb', label: 'IMDb' },
  { source: 'metacritic', label: 'Metacritic' },
  { source: 'tmdb', label: 'TMDB' },
]

type Column = 'title' | 'years' | 'episodes' | RatingSource

const score = ({ entry, source }: { entry: ShowEntry; source: RatingSource }): number | null =>
  entry.show.ratings.find((rating) => rating.source === source)?.value ?? null

const COLUMNS: Record<Column, SortColumn<ShowEntry>> = {
  title: { value: (entry) => sortTitle(entry.show.title), first: 'asc' },
  years: { value: (entry) => entry.show.year, first: 'desc' },
  episodes: { value: (entry) => entry.episodes, first: 'desc' },
  rottenTomatoes: {
    value: (entry) => score({ entry, source: RATING_SOURCES.rottenTomatoes }),
    first: 'desc',
  },
  imdb: { value: (entry) => score({ entry, source: RATING_SOURCES.imdb }), first: 'desc' },
  metacritic: {
    value: (entry) => score({ entry, source: RATING_SOURCES.metacritic }),
    first: 'desc',
  },
  tmdb: { value: (entry) => score({ entry, source: RATING_SOURCES.tmdb }), first: 'desc' },
}

/** One show as a table row, its small poster before its title. */
const ShowRow = ({ entry }: { entry: ShowEntry }) => {
  const select = useSelectable({ key: showEntryKey(entry.show), title: entry.show.title })
  return (
    <tr data-entry={showEntryKey(entry.show)} {...select.rootProps}>
      <th scope="row" className={styles.titleHeader}>
        <div className={styles.titleCell}>
          <SelectCheckbox select={select} />
          <SmallPoster entry={entry} inRow />
          <CardLink
            to={`/shows/${entry.show.id}`}
            className={styles.title}
            tabIndex={select.linkTabIndex}
          >
            {entry.show.title}
          </CardLink>
          <WatchedCount watched={entry.watchedEpisodes} total={entry.episodes} />
        </div>
      </th>
      <td className={`${styles.number} ${styles.spare}`}>
        {showYears({ year: entry.show.year, endedYear: entry.endedYear }) ?? ''}
      </td>
      <td className={`${styles.number} ${styles.spare}`}>{entry.episodes}</td>
      {RATING_COLUMNS.map((column) => {
        const rating = entry.show.ratings.find((it) => it.source === column.source)
        return (
          <td key={column.source} className={`${styles.number} ${styles.roomy}`}>
            {rating && <ScoreChip rating={rating} />}
          </td>
        )
      })}
      <td className={styles.playCell}>{!select.selecting && <NextPlay entry={entry} />}</td>
    </tr>
  )
}

/** Every show as a row of facts: title, years, episodes on disk and each of its scores, every column sortable. */
export const ShowList = ({ shows }: { shows: ShowEntry[] }) => {
  const { sorted, toggle, ariaSort } = useTableSort({ rows: shows, columns: COLUMNS })
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
      <table className={styles.table} aria-label="Shows">
        <thead>
          <tr>
            {header({ key: 'title', label: 'Title' })}
            {header({
              key: 'years',
              label: 'Years',
              className: `${styles.number} ${styles.spare}`,
            })}
            {header({
              key: 'episodes',
              label: 'Episodes',
              className: `${styles.number} ${styles.spare}`,
            })}
            {RATING_COLUMNS.map((column) =>
              header({
                key: column.source,
                label: column.label,
                className: `${styles.number} ${styles.roomy}`,
              }),
            )}
            <th scope="col">
              <span className="visually-hidden">Play</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => (
            <ShowRow key={entry.show.id} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One show as a tile: a card with a small poster, its title and facts beside it. */
const ShowTile = ({ entry, sort }: { entry: ShowEntry; sort: MediaSort | undefined }) => {
  const select = useSelectable({ key: showEntryKey(entry.show), title: entry.show.title })
  const sorted = sort ? showSortFact({ entry, sort }) : null
  const facts = [
    showYears({ year: entry.show.year, endedYear: entry.endedYear }),
    episodesLabel(entry),
  ].filter((fact): fact is string => fact != null)
  const isStarted =
    watchedStateOf({ watched: entry.watchedEpisodes, total: entry.episodes }) !==
    WATCHED_STATES.unwatched
  return (
    <li className={styles.tile} data-entry={showEntryKey(entry.show)} {...select.rootProps}>
      <SelectCheckbox select={select} className={styles.select} />
      <SmallPoster entry={entry} />
      <div className={styles.body}>
        <CardLink
          to={`/shows/${entry.show.id}`}
          className={styles.title}
          tabIndex={select.linkTabIndex}
        >
          {entry.show.title}
        </CardLink>
        {sorted && <span className={styles.sorted}>{sorted}</span>}
        <span className={styles.facts}>
          {facts.map((fact) => (
            <span key={fact} className={styles.fact}>
              {fact}
            </span>
          ))}
          {isStarted && (
            <span className={styles.fact}>
              <WatchedCount watched={entry.watchedEpisodes} total={entry.episodes} />
            </span>
          )}
        </span>
        {entry.show.ratings.length > 0 && (
          <ul className={styles.scores} aria-label="Ratings">
            {entry.show.ratings.map((rating) => (
              <li key={rating.source}>
                <ScoreChip rating={rating} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {!select.selecting && <NextPlay entry={entry} />}
    </li>
  )
}

/** Every show as a tile, as many side by side as fit, each a small poster beside its facts. */
export const ShowTiles = ({
  shows,
  sort,
}: {
  shows: ShowEntry[]
  /** The order the listing is in, whose value each tile shows. */
  sort?: MediaSort
}) => (
  <ul className={styles.tiles} aria-label="Shows">
    {shows.map((entry) => (
      <ShowTile key={entry.show.id} entry={entry} sort={sort} />
    ))}
  </ul>
)
