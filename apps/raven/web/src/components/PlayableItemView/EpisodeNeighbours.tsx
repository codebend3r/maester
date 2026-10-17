import { useQuery } from '@tanstack/react-query'
import { type EpisodeSummary, type ItemDetails, episodeCode } from '@raven/core'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { inLibrary } from '@/lib/itemLinks'
import { itemQuery } from '@/lib/queries'
import styles from '@/components/PlayableItemView/EpisodeNeighbours.module.scss'

/** The still an episode's row shows: TMDB's or the one beside the file, else a frame of the file. */
const stillOf = (episode: EpisodeSummary): string | null => {
  if (episode.stillVersion != null)
    return api.itemImageUrl({ id: episode.id, kind: 'still', version: episode.stillVersion })
  return episode.primary ? api.thumbnailUrl(episode.primary) : null
}

/**
 * The episodes either side of `episode` in its season on disk, read from
 * its show and season as the season's page reads them; none for the first
 * or last, nor before both are known.
 */
export const useNeighbours = (
  episode: ItemDetails,
): Array<{ direction: 'Previous' | 'Next'; episode: EpisodeSummary }> => {
  const show = useQuery(itemQuery(episode.show?.id ?? null))
  const season = show.data?.children.find(
    (child) => child.type === 'season' && child.season === episode.season,
  )
  const seasonQuery = useQuery(itemQuery(season?.id ?? null))
  const episodes = (seasonQuery.data?.children ?? []).flatMap((child) =>
    child.type === 'episode' ? [child] : [],
  )
  const at = episodes.findIndex((each) => each.id === episode.id)
  if (at < 0) return []
  const before = episodes[at - 1]
  const after = episodes[at + 1]
  return [
    ...(before ? [{ direction: 'Previous' as const, episode: before }] : []),
    ...(after ? [{ direction: 'Next' as const, episode: after }] : []),
  ]
}

/**
 * The previous and next episodes as cards: each still, which way it is,
 * its title and its number, opening its page in the same library.
 */
export const EpisodeNeighbours = ({
  episode,
  libraryId,
  className,
}: {
  episode: ItemDetails
  libraryId: number
  className?: string
}) => {
  const neighbours = useNeighbours(episode)
  if (neighbours.length === 0) return null
  return (
    <nav
      className={[styles.neighbours, className ?? ''].join(' ')}
      aria-label="Episodes either side"
    >
      <ul className={styles.list}>
        {neighbours.map(({ direction, episode: neighbour }) => {
          const still = stillOf(neighbour)
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
