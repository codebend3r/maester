import type { ItemSummary, MediaItem, ShowEntry } from '@raven/core'

/**
 * One season as a TV library's Seasons view lists it: the show it belongs
 * to, whose poster it wears, its number, and its episodes on disk in order.
 */
export type SeasonEntry = { show: ItemSummary; season: number; episodes: MediaItem[] }

type SeasonsOfProps = { shows: readonly ShowEntry[]; files: readonly MediaItem[] }

/** Specials (season 0) go after a show's numbered seasons. */
const seasonRank = (season: number): number => (season === 0 ? Number.POSITIVE_INFINITY : season)

const episodeOf = (file: MediaItem): number => file.item?.episode ?? 0

/**
 * The seasons of `shows`, which `files`, every episode the library holds,
 * fill: the shows in the order they list, each one's seasons by number with
 * its specials last, and each season's episodes by number.
 */
export const seasonsOf = ({ shows, files }: SeasonsOfProps): SeasonEntry[] => {
  // The accumulator is this call's own, so filling it in place leaves nothing shared changed.
  const byShow = files.reduce((held, file) => {
    const show = file.item?.show
    const season = file.item?.season
    if (show == null || season == null) return held
    const seasons = held.get(show.id) ?? new Map<number, MediaItem[]>()
    seasons.set(season, [...(seasons.get(season) ?? []), file])
    return held.set(show.id, seasons)
  }, new Map<number, Map<number, MediaItem[]>>())
  return shows.flatMap(({ show }) =>
    [...(byShow.get(show.id) ?? new Map<number, MediaItem[]>())]
      .toSorted(([a], [b]) => seasonRank(a) - seasonRank(b))
      .map(([season, episodes]) => ({
        show,
        season,
        episodes: episodes.toSorted((a, b) => episodeOf(a) - episodeOf(b)),
      })),
  )
}

/** What Play starts in a season: its first episode not yet watched, else its first. */
export const seasonNext = ({ episodes }: SeasonEntry): MediaItem | undefined =>
  episodes.find((episode) => !episode.watched) ?? episodes.at(0)
