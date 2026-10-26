import { useQuery } from '@tanstack/react-query'
import {
  type EpisodeSummary,
  type ItemDetails,
  episodeCode,
  episodeStillUrl,
  episodesOf,
  inLibrary,
  seasonsOf,
} from '@raven/core'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { itemQuery } from '@/lib/queries'
import styles from '@/components/PlayableItemView/EpisodeNeighbours.module.scss'

/**
 * The episodes either side of `episode` in its season on disk, read from
 * its show and season as the season's page reads them; none for the first
 * or last, nor before both are known.
 */
const useNeighbours = (
  episode: ItemDetails,
): Array<{ direction: 'Previous' | 'Next'; episode: EpisodeSummary }> => {
  const show = useQuery(itemQuery(episode.show?.id ?? null))
  const season = (show.data ? seasonsOf(show.data) : []).find(
    (child) => child.season === episode.season,
  )
  const seasonQuery = useQuery(itemQuery(season?.id ?? null))
  const episodes = seasonQuery.data ? episodesOf(seasonQuery.data) : []
  const at = episodes.findIndex((each) => each.id === episode.id)
  if (at < 0) return []
  const before = episodes[at - 1]
  const after = episodes[at + 1]
  return [
    ...(before ? [{ direction: 'Previous' as const, episode: before }] : []),
    ...(after ? [{ direction: 'Next' as const, episode: after }] : []),
  ]
}

type EpisodeNeighboursProps = {
  episode: ItemDetails
  libraryId: number
  className?: string
}

/**
 * The previous and next episodes as cards: each still, which way it is,
 * its title and its number, opening its page in the same library.
 */
export const EpisodeNeighbours = ({ episode, libraryId, className }: EpisodeNeighboursProps) => {
  const neighbours = useNeighbours(episode)
  if (neighbours.length === 0) return null
  return (
    <nav
      className={[styles.neighbours, className ?? ''].join(' ')}
      aria-label="Episodes either side"
    >
      <ul className={styles.list}>
        {neighbours.map(({ direction, episode: neighbour }) => {
          const still = episodeStillUrl({ api, episode: neighbour })
          return (
            <li key={neighbour.id}>
              <Link
                to={inLibrary({ page: `/episodes/${neighbour.id}`, libraryId })}
                className={styles.card}
                aria-label={`${direction}: ${neighbour.title}`}
              >
                <span className={styles.still}>
                  {still && <img src={still} alt="" loading="lazy" decoding="async" />}
                </span>
                <span className={styles.direction}>{direction}</span>
                <span className={styles.title}>{neighbour.title}</span>
                <span className={styles.code}>{episodeCode(neighbour)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
