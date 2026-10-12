import {
  type MediaSort,
  type RatingSource,
  type ShowEntry,
  episodeCode,
  showSortFact,
  sortTitle,
} from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { RatingChips, ScoreChip } from '@/components/RatingChips/RatingChips'
import { SortHeader } from '@/components/SortHeader/SortHeader'
import { api } from '@/lib/api'
import { showYears } from '@/lib/itemLinks'
import { type SortColumn, useTableSort } from '@/lib/tableSort'
import styles from '@/components/ShowCard/ShowViews.module.scss'

const episodesLabel = (entry: ShowEntry): string =>
  `${entry.episodes} ${entry.episodes === 1 ? 'episode' : 'episodes'}`

/** The play button a show's row carries: its first episode not yet watched, when there is one. */
const NextPlay = ({ entry }: { entry: ShowEntry }) => {
  const { show, next } = entry
  if (!next) return null
  const code = next.item ? episodeCode(next.item) : null
  return (
    <Link
      to={`/watch/${next.id}`}
      state={{ media: next }}
      className={styles.play}
      aria-label={code ? `Play ${show.title} ${code}` : `Play ${show.title}`}
    >
      <Icon name="play" size={16} />
    </Link>
  )
}

/** A show's small poster, or its initial; a second way to the page, so out of the tab order. */
const SmallPoster = ({ entry }: { entry: ShowEntry }) => {
  const { show } = entry
  const poster = api.itemImageUrl({ id: show.id, kind: 'poster', version: show.posterVersion })
  const [failed, setFailed] = useState(false)
  return (
    <Link to={`/shows/${show.id}`} className={styles.frame} tabIndex={-1} aria-hidden="true">
      {poster && !failed ? (
        <img
          className={styles.image}
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.placeholder}>{show.title.slice(0, 1)}</span>
      )}
    </Link>
  )
}

const RATING_COLUMNS: readonly { source: RatingSource; label: string }[] = [
  { source: 'rottenTomatoes', label: 'RT' },
  { source: 'imdb', label: 'IMDb' },
  { source: 'metacritic', label: 'Metacritic' },
  { source: 'tmdb', label: 'TMDB' },
]

type Column = 'title' | 'years' | 'episodes' | RatingSource

const score = (entry: ShowEntry, source: RatingSource): number | null =>
  entry.show.ratings.find((rating) => rating.source === source)?.value ?? null

const COLUMNS: Record<Column, SortColumn<ShowEntry>> = {
  title: { value: (entry) => sortTitle(entry.show.title), first: 'asc' },
  years: { value: (entry) => entry.show.year, first: 'desc' },
  episodes: { value: (entry) => entry.episodes, first: 'desc' },
  rottenTomatoes: { value: (entry) => score(entry, 'rottenTomatoes'), first: 'desc' },
  imdb: { value: (entry) => score(entry, 'imdb'), first: 'desc' },
  metacritic: { value: (entry) => score(entry, 'metacritic'), first: 'desc' },
  tmdb: { value: (entry) => score(entry, 'tmdb'), first: 'desc' },
}

/** Every show as a row of facts: title, years, episodes on disk and each of its scores, every column sortable. */
export const ShowList = ({ shows, busy = false }: { shows: ShowEntry[]; busy?: boolean }) => {
  const { sorted, toggle, ariaSort } = useTableSort({ rows: shows, columns: COLUMNS })
  const header = (key: Column, label: string, className?: string) => (
    <SortHeader sort={ariaSort(key)} onToggle={() => toggle(key)} className={className}>
      {label}
    </SortHeader>
  )
  return (
    <table className={styles.table} aria-label="Shows" aria-busy={busy}>
      <thead>
        <tr>
          {header('title', 'Title')}
          {header('years', 'Years', styles.number)}
          {header('episodes', 'Episodes', styles.number)}
          {RATING_COLUMNS.map((column) =>
            header(column.source, column.label, `${styles.number} ${styles.roomy}`),
          )}
          <th scope="col">
            <span className="visually-hidden">Play</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((entry) => (
          <tr key={entry.show.id} className={styles.row}>
            <th scope="row">
              <Link to={`/shows/${entry.show.id}`} className={styles.title}>
                {entry.show.title}
              </Link>
            </th>
            <td className={styles.number}>
              {showYears({ year: entry.show.year, endedYear: entry.endedYear }) ?? ''}
            </td>
            <td className={styles.number}>{entry.episodes}</td>
            {RATING_COLUMNS.map((column) => {
              const rating = entry.show.ratings.find((it) => it.source === column.source)
              return (
                <td key={column.source} className={`${styles.number} ${styles.roomy}`}>
                  {rating && <ScoreChip rating={rating} />}
                </td>
              )
            })}
            <td className={styles.playCell}>
              <NextPlay entry={entry} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Every show as a row with a small poster, its title and facts beside it. */
export const ShowTiles = ({
  shows,
  busy = false,
  sort,
}: {
  shows: ShowEntry[]
  busy?: boolean
  /** The order the listing is in, whose value each tile shows. */
  sort?: MediaSort
}) => (
  <ul className={styles.tiles} aria-label="Shows" aria-busy={busy}>
    {shows.map((entry) => {
      const sorted = sort ? showSortFact({ entry, sort }) : null
      const facts = [
        showYears({ year: entry.show.year, endedYear: entry.endedYear }),
        episodesLabel(entry),
      ].filter((fact): fact is string => fact != null)
      return (
        <li key={entry.show.id} className={styles.tile}>
          <SmallPoster entry={entry} />
          <div className={styles.body}>
            <Link to={`/shows/${entry.show.id}`} className={styles.title}>
              {entry.show.title}
            </Link>
            {sorted && <span className={styles.sorted}>{sorted}</span>}
            <span className={styles.facts}>
              {facts.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </span>
            <RatingChips ratings={entry.show.ratings} />
          </div>
          <NextPlay entry={entry} />
        </li>
      )
    })}
  </ul>
)
