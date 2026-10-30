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
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { itemQuery } from '@/lib/queries'
import { PLAYABLE_ITEM_VIEW_COPY } from '@/components/PlayableItemView/copy'
import styles from '@/components/PlayableItemView/EpisodeNeighbours.module.scss'

/** Which way a neighbour is from the episode. */
const DIRECTIONS = {
  previous: 'previous',
  next: 'next',
} as const

type Direction = (typeof DIRECTIONS)[keyof typeof DIRECTIONS]

const DIRECTION_LABELS = {
  [DIRECTIONS.previous]: PLAYABLE_ITEM_VIEW_COPY.previous,
  [DIRECTIONS.next]: PLAYABLE_ITEM_VIEW_COPY.next,
} as const satisfies Record<Direction, string>

type Neighbour = { direction: Direction; episode: EpisodeSummary }

/**
 * The episodes either side of `episode` in its season on disk, read from
 * its show and season as the season's page reads them; none for the first
 * or last, nor before both are known.
 */
const useNeighbours = (episode: ItemDetails): Neighbour[] => {
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
    ...(before ? [{ direction: DIRECTIONS.previous, episode: before }] : []),
    ...(after ? [{ direction: DIRECTIONS.next, episode: after }] : []),
  ]
}

type EpisodeNeighboursProps = {
  episode: ItemDetails
  libraryId: number
  className?: string
}

type NeighbourListProps = {
  neighbours: Neighbour[]
  libraryId: number
  className?: string
}

const NeighbourList = ({ neighbours, libraryId, className }: NeighbourListProps) => (
  <nav
    className={[styles.neighbours, className ?? ''].join(' ')}
    aria-label={PLAYABLE_ITEM_VIEW_COPY.neighbours}
  >
    <ul className={styles.list}>
      {neighbours.map(({ direction, episode: neighbour }) => {
        const still = episodeStillUrl({ api, episode: neighbour })
        return (
          <li key={neighbour.id}>
            <Link
              to={inLibrary({ page: `/episodes/${neighbour.id}`, libraryId })}
              className={styles.card}
              aria-label={PLAYABLE_ITEM_VIEW_COPY.neighbourLabel({
                direction: DIRECTION_LABELS[direction],
                title: neighbour.title,
              })}
            >
              <span className={styles.still}>
                {still && <img src={still} alt="" loading="lazy" decoding="async" />}
              </span>
              <span className={styles.direction}>{DIRECTION_LABELS[direction]}</span>
              <span className={styles.title}>{neighbour.title}</span>
              <span className={styles.code}>{episodeCode(neighbour)}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  </nav>
)

/** Whether the episode has a neighbour on disk either side. */
const NEIGHBOUR_COUNTS = {
  none: 'none',
  some: 'some',
} as const

type NeighbourCount = (typeof NEIGHBOUR_COUNTS)[keyof typeof NEIGHBOUR_COUNTS]

const NEIGHBOUR_VIEWS = {
  [NEIGHBOUR_COUNTS.none]: () => null,
  [NEIGHBOUR_COUNTS.some]: NeighbourList,
} as const satisfies Record<NeighbourCount, ComponentType<NeighbourListProps>>

/**
 * The previous and next episodes as cards: each still, which way it is,
 * its title and its number, opening its page in the same library.
 */
export const EpisodeNeighbours = ({ episode, libraryId, className }: EpisodeNeighboursProps) => {
  const neighbours = useNeighbours(episode)
  const View =
    NEIGHBOUR_VIEWS[neighbours.length === 0 ? NEIGHBOUR_COUNTS.none : NEIGHBOUR_COUNTS.some]
  return <View neighbours={neighbours} libraryId={libraryId} className={className} />
}
