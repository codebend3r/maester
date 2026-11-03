import {
  CREDIT_JOBS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  formatRuntime,
  primaryVersion,
  progressOf,
  tileWords,
} from '@raven/core'
import { BINGE_CARD_COPY } from '@/components/BingeCard/copy'
import { timeLeft } from '@/pages/HomePage/ContinueWatching'

/** How many of the cast the card names. */
const STAR_COUNT = 2

type BingeCardFactsProps = {
  /** The movie or show the card is for. */
  details: ItemDetails
  /** What a show is on now: its next or resumed episode, as the server names it; null when none. */
  next: MediaItem | null
  /** That episode's own page, whose synopsis the card shows; null until read, or for a movie. */
  episode: ItemDetails | null
}

/** What the card writes of its title. */
export type BingeCardFacts = {
  title: string
  year: string | null
  runtime: string | null
  stars: string[]
  synopsis: string | null
  /** A show's episode, `S05E01 · Title`; null for a movie. */
  episodeLine: string | null
  /** The file whose progress and Play the card carries: the movie's, or the show's episode; null when none. */
  media: MediaItem | null
  /**
   * The words at the card's foot: how long is left of a video in progress, or
   * which episode a show starts on; null for a movie not yet started.
   */
  status: string | null
}

/** "23m left" once started, else "Start season 1 episode 2" for an episode; null otherwise. */
const statusOf = (media: MediaItem | null): string | null => {
  if (!media) return null
  if (progressOf(media) > 0) return timeLeft(media)
  const item = media.item
  if (item?.type !== ITEM_TYPES.episode || item.season == null || item.episode == null) return null
  return BINGE_CARD_COPY.start({ season: item.season, episode: item.episode })
}

/**
 * The facts a Binge card shows of a movie or a show: its title and year, how
 * long it runs, its two leading stars, how far along it is, and a synopsis.
 * A movie's synopsis, length and progress are its own; a show's are those of
 * the episode it is on, with the show's own synopsis where that episode has
 * none.
 */
export const bingeCardFacts = ({ details, next, episode }: BingeCardFactsProps): BingeCardFacts => {
  const isShow = details.type === ITEM_TYPES.show
  const media = isShow ? next : (primaryVersion(details.versions) ?? null)
  const seconds = media?.duration ?? (details.runtime == null ? null : details.runtime * 60)
  const episodeWords = isShow && media ? tileWords(media).line : null
  return {
    title: details.title,
    year: details.year == null ? null : String(details.year),
    runtime: formatRuntime(seconds),
    stars: details.credits
      .filter((credit) => credit.job === CREDIT_JOBS.cast)
      .slice(0, STAR_COUNT)
      .map((credit) => credit.name),
    synopsis: (isShow ? (episode?.summary ?? details.summary) : details.summary) ?? null,
    episodeLine: episodeWords,
    media,
    status: statusOf(media),
  }
}
