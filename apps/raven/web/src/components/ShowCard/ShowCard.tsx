import { type ShowEntry, type RatingSource, episodeCode, pickScore } from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { ScoreChip } from '@/components/RatingChips/RatingChips'
import { api } from '@/lib/api'
import { showYears } from '@/lib/itemLinks'
import styles from '@/components/ShowCard/ShowCard.module.scss'

/**
 * A show as a poster, its title, years and episode count beneath. The card
 * opens the show's page; its play button starts the first episode not yet
 * watched, carrying the file along so the player starts at once.
 */
export const ShowCard = ({
  entry,
  ratingsSource = 'tmdb',
}: {
  entry: ShowEntry
  ratingsSource?: RatingSource
}) => {
  const { show, next } = entry
  const score = pickScore({ ratings: show.ratings, source: ratingsSource })
  const poster = api.itemImageUrl({ id: show.id, kind: 'poster', version: show.posterVersion })
  const [failed, setFailed] = useState(false)
  const years = showYears({ year: show.year, endedYear: entry.endedYear })
  const code = next?.item ? episodeCode(next.item) : null
  const facts = [
    years,
    `${entry.episodes} ${entry.episodes === 1 ? 'episode' : 'episodes'}`,
  ].filter((fact): fact is string => fact != null)

  return (
    <li className={styles.card}>
      <Link to={`/shows/${show.id}`} className={styles.picture} tabIndex={-1} aria-hidden="true">
        <span className={styles.frame}>
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
        </span>
      </Link>
      {next && (
        <span className={styles.overlay}>
          <Link
            to={`/watch/${next.id}`}
            state={{ media: next }}
            className={styles.play}
            aria-label={code ? `Play ${show.title} ${code}` : `Play ${show.title}`}
          >
            <Icon name="play" size={18} />
          </Link>
        </span>
      )}
      <Link to={`/shows/${show.id}`} className={styles.title}>
        {show.title}
      </Link>
      <span className={styles.facts}>
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
        {score && <ScoreChip rating={score} />}
      </span>
    </li>
  )
}

/** The poster grid a TV library lays its shows out in. */
export const ShowGrid = ({
  shows,
  busy = false,
  ratingsSource = 'tmdb',
}: {
  shows: ShowEntry[]
  busy?: boolean
  ratingsSource?: RatingSource
}) => (
  <ul className={styles.grid} aria-busy={busy}>
    {shows.map((entry) => (
      <ShowCard key={entry.show.id} entry={entry} ratingsSource={ratingsSource} />
    ))}
  </ul>
)
