import { type ShowEntry, type ShownRatings, episodeCode } from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { RatingChips } from '@/components/RatingChips/RatingChips'
import { api } from '@/lib/api'
import { showYears } from '@/lib/itemLinks'
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

/** Every show as a row of facts: title, years, episodes on disk and its score. */
export const ShowList = ({
  shows,
  busy = false,
  labelledBy,
}: {
  shows: ShowEntry[]
  busy?: boolean
  /** Kept for the callers that pass it; every rating shows here. */
  ratingsSource?: ShownRatings
  labelledBy?: string
}) => (
  <table
    className={styles.table}
    aria-label={labelledBy ? undefined : 'Shows'}
    aria-labelledby={labelledBy}
    aria-busy={busy}
  >
    <thead>
      <tr>
        <th scope="col">Title</th>
        <th scope="col" className={styles.number}>
          Years
        </th>
        <th scope="col" className={styles.number}>
          Episodes
        </th>
        <th scope="col" className={styles.roomy}>
          Ratings
        </th>
        <th scope="col">
          <span className="visually-hidden">Play</span>
        </th>
      </tr>
    </thead>
    <tbody>
      {shows.map((entry) => {
        return (
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
            <td className={styles.roomy}>
              <RatingChips ratings={entry.show.ratings} />
            </td>
            <td className={styles.playCell}>
              <NextPlay entry={entry} />
            </td>
          </tr>
        )
      })}
    </tbody>
  </table>
)

/** Every show as a row with a small poster, its title and facts beside it. */
export const ShowTiles = ({
  shows,
  busy = false,
  labelledBy,
}: {
  shows: ShowEntry[]
  busy?: boolean
  /** Kept for the callers that pass it; every rating shows here. */
  ratingsSource?: ShownRatings
  labelledBy?: string
}) => (
  <ul
    className={styles.tiles}
    aria-label={labelledBy ? undefined : 'Shows'}
    aria-labelledby={labelledBy}
    aria-busy={busy}
  >
    {shows.map((entry) => {
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
