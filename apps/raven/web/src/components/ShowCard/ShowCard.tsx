import {
  type MediaSort,
  type RatingSource,
  type ShowEntry,
  episodeCode,
  pickScore,
  showSortFact,
} from '@raven/core'
import { useState } from 'react'
import { CardLink } from '@/components/CardLink/CardLink'
import { Icon } from '@raven/ui'
import { ScoreChip } from '@/components/RatingChips/RatingChips'
import { ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import { api } from '@/lib/api'
import { showYears } from '@/lib/itemLinks'
import { POSTER_SIZES, type PosterSizes, posterSources } from '@/lib/posters'
import { showEntryKey } from '@/lib/entryKeys'
import { useHoverBackdrop } from '@/lib/useHoverBackdrop'
import styles from '@/components/ShowCard/ShowCard.module.scss'

/**
 * A show as a poster, its title, years and episode count beneath. The card
 * opens the show's page; its play button starts the first episode not yet
 * watched, carrying the file along so the player starts at once. Sorted by
 * when shows were added, it says when the newest episode came.
 */
export const ShowCard = ({
  entry,
  ratingsSource = 'tmdb',
  sort,
  sizes,
}: {
  entry: ShowEntry
  ratingsSource?: RatingSource
  /** The order the listing is in, whose value the card shows. */
  sort?: MediaSort
  /** How wide the list holding the card shows its poster. */
  sizes: PosterSizes
}) => {
  const { show, next } = entry
  const score = pickScore({ ratings: show.ratings, source: ratingsSource })
  const poster = posterSources({ item: show, sizes })
  const hover = useHoverBackdrop(
    api.itemImageUrl({ id: show.id, kind: 'backdrop', version: show.backdropVersion }),
  )
  const [failed, setFailed] = useState(false)
  const years = showYears({ year: show.year, endedYear: entry.endedYear })
  const code = next?.item ? episodeCode(next.item) : null
  const sorted = sort ? showSortFact({ entry, sort }) : null
  const facts = [
    years,
    `${entry.episodes} ${entry.episodes === 1 ? 'episode' : 'episodes'}`,
  ].filter((fact): fact is string => fact != null)

  return (
    <li className={styles.card} data-entry={showEntryKey(show)} {...hover}>
      <CardLink
        to={`/shows/${show.id}`}
        className={styles.picture}
        tabIndex={-1}
        aria-hidden="true"
      >
        <span className={styles.frame}>
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
        </span>
      </CardLink>
      {next && (
        <span className={styles.overlay}>
          <ResolutionChip media={next} className={styles.quality} />
          <CardLink
            to={`/watch/${next.id}`}
            state={{ media: next }}
            className={styles.play}
            aria-label={code ? `Play ${show.title} ${code}` : `Play ${show.title}`}
          >
            <Icon name="play" size={18} />
          </CardLink>
        </span>
      )}
      <CardLink to={`/shows/${show.id}`} className={styles.title}>
        {show.title}
      </CardLink>
      {sorted && <span className={styles.sorted}>{sorted}</span>}
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
  ratingsSource = 'tmdb',
  sort,
}: {
  shows: ShowEntry[]
  ratingsSource?: RatingSource
  sort?: MediaSort
}) => (
  <ul className={styles.grid}>
    {shows.map((entry) => (
      <ShowCard
        key={entry.show.id}
        entry={entry}
        ratingsSource={ratingsSource}
        sort={sort}
        sizes={POSTER_SIZES.grid}
      />
    ))}
  </ul>
)
