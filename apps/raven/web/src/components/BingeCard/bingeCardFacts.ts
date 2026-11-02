import {
  CREDIT_JOBS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  formatRuntime,
  primaryVersion,
  tileWords,
} from '@raven/core'
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
  left: string | null
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
    left: media ? timeLeft(media) : null,
  }
}
