import {
  ITEM_TYPES,
  type ItemSummary,
  type MediaItem,
  RATING_SOURCES,
  type Rating,
  type RatingSource,
} from '@/contract'
import { releaseLabel } from '@/itemFacts'

const pad = (value: number): string => String(value).padStart(2, '0')

type EpisodeCodeProps = {
  season: number | null
  episode: number | null
}

/** "S01E02", or "S01" for a season; null when there is no number to show. */
export const episodeCode = ({ season, episode }: EpisodeCodeProps): string | null => {
  if (season == null) return null
  return episode == null ? `S${pad(season)}` : `S${pad(season)}E${pad(episode)}`
}

/** "S01", a season's mark as the player and an episode's page set it apart from the episode's. */
export const seasonTag = (season: number): string => `S${pad(season)}`

/** "E02", an episode's mark beside its season's. */
export const episodeNumberTag = (episode: number): string => `E${pad(episode)}`

/** How `episodeTag` names season 0's episodes, which have no number worth padding. */
const EPISODE_TAG_COPY = {
  specials: 'Specials',
  special: (episode: number) => `Special ${episode}`,
} as const

/**
 * An episode's place in short, as the player and an episode's page set it apart: "S01 · E02",
 * "S01" for a season, "Special 5" or "Specials" for season 0; null without a season.
 */
export const episodeTag = ({ season, episode }: EpisodeCodeProps): string | null => {
  if (season == null) return null
  if (season === 0)
    return episode == null ? EPISODE_TAG_COPY.specials : EPISODE_TAG_COPY.special(episode)
  return episode == null ? seasonTag(season) : `${seasonTag(season)} · ${episodeNumberTag(episode)}`
}

/** "The Matrix (1999)", or "Severance · S01E02 · Half Loop" for an episode. */
export const itemLabel = (item: ItemSummary): string => {
  if (item.type === ITEM_TYPES.episode || item.type === ITEM_TYPES.season) {
    return [
      item.show?.title ?? null,
      episodeCode(item),
      item.type === ITEM_TYPES.episode ? item.title : null,
    ]
      .filter((part): part is string => part != null && part !== '')
      .join(' · ')
  }
  return item.year == null ? item.title : `${item.title} (${item.year})`
}

/**
 * The name a video goes by outside its library page: the history, the
 * favourites and the player. A matched file takes its item's name; an
 * unmatched one in a Movies library its parsed title and year.
 */
export const mediaLabel = (media: MediaItem): string => {
  if (media.item) return itemLabel(media.item)
  return media.year == null ? media.title : `${media.title} (${media.year})`
}

/**
 * Where an episode falls in its show, as the up next card says it: "Season
 * 2, Episode 4", or "Special 3" for season 0. Null for anything else.
 */
export const episodePlace = (media: MediaItem): string | null => {
  const item = media.item
  if (item?.type !== ITEM_TYPES.episode || item.season == null || item.episode == null) return null
  if (item.season === 0) return `Special ${item.episode}`
  return `Season ${item.season}, Episode ${item.episode}`
}

/** The version Play starts: a saved spot wins, so Play resumes where the viewer stopped, in whichever version. */
export const primaryVersion = (versions: readonly MediaItem[]): MediaItem | undefined =>
  versions.find((version) => version.position > 0) ?? versions[0]

export type CardTitle = {
  title: string
  /** The release day, or the year when that is all that is known; what a card says under the title. */
  date: string | null
}

/**
 * The title a card shows, and the release day beneath it. An episode's title
 * alone says little on a poster, so it comes with its show and number, and no
 * date. A movie split onto several cards names each card's cut or release
 * after the title: `Alexander (Revisited the Final Cut)`.
 */
export const cardTitle = (media: MediaItem): CardTitle => {
  if (!media.item) return { title: media.title, date: releaseLabel({ year: media.year }) }
  if (media.item.type === ITEM_TYPES.episode) return { title: itemLabel(media.item), date: null }
  const title = media.variant == null ? media.item.title : `${media.item.title} (${media.variant})`
  return { title, date: releaseLabel(media.item) }
}

type EpisodeLineProps = EpisodeCodeProps & { title: string }

/** An episode's code and title, "S01E02 · Half Loop", as its show's name or art heads it; null with neither. */
export const episodeLine = ({ season, episode, title }: EpisodeLineProps): string | null => {
  const line = [episodeCode({ season, episode }), title]
    .filter((part): part is string => part != null && part !== '')
    .join(' · ')
  return line === '' ? null : line
}

/** What `artItemIdOf` reads of an item: its id, and its show's when it is part of one. */
type ArtItem = Pick<ItemSummary, 'id' | 'show'>

/**
 * The item whose art stands for `item`: an episode or season wears its show's, since only a show
 * or a film has title art and a backdrop.
 */
export const artItemIdOf = (item: ArtItem): number => item.show?.id ?? item.id

type TileWords = { title: string; line: string | null }

/** What a wide tile names: the show, with the episode under it, else the movie and its release day. */
export const tileWords = (media: MediaItem): TileWords => {
  const { item } = media
  if (item && item.type === ITEM_TYPES.episode && item.show) {
    return { title: item.show.title, line: episodeLine(item) }
  }
  const { title, date } = cardTitle(media)
  return { title, line: date }
}

type PickScoreProps = {
  ratings: readonly Rating[]
  source: RatingSource
}

/** The score a card shows: the library's chosen source, else TMDB's, else none. */
export const pickScore = ({ ratings, source }: PickScoreProps): Rating | null =>
  ratings.find((rating) => rating.source === source) ??
  ratings.find((rating) => rating.source === RATING_SOURCES.tmdb) ??
  null

/** How a score reads for its source: "82%", "7.5" out of 10, or "74" out of 100. */
export const formatScore = (rating: Rating): string => {
  if (rating.source === RATING_SOURCES.imdb) return rating.value.toFixed(1)
  if (rating.source === RATING_SOURCES.metacritic) return String(Math.round(rating.value * 10))
  return `${Math.round(rating.value * 10)}%`
}
