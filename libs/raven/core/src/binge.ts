import { CREDIT_JOBS, ITEM_TYPES, type ItemDetails, type MediaItem } from '@/contract'
import { formatRuntime } from '@/format'
import { tileWords } from '@/items'
import { progressOf } from '@/mediaProgress'

/** How many of the cast a Binge card names. */
const STAR_COUNT = 2

/** What a Binge card's foot says: how long is left of the episode, or which one the show starts on. */
export const BINGE_STATUS_KINDS = {
  left: 'left',
  start: 'start',
} as const

export type BingeStatus =
  | { kind: typeof BINGE_STATUS_KINDS.left; media: MediaItem }
  | { kind: typeof BINGE_STATUS_KINDS.start; season: number; episode: number }

type BingeCardFactsProps = {
  /** The show the card is for. */
  details: ItemDetails
  /** The episode the show is on, its next or resumed one, as the server names it; null when none. */
  next: MediaItem | null
  /** That episode's own page, whose synopsis the card shows; null until read. */
  episode: ItemDetails | null
}

/** What a Binge card says of its show, for each client to word with its own copy. */
export type BingeCardFacts = {
  year: string | null
  /** The episode's length, else the show's runtime, `55m`; null with neither. */
  runtime: string | null
  stars: string[]
  /** The episode's synopsis, else the show's; null when neither has one. */
  synopsis: string | null
  /** The episode it is on, `S05E01 · Title`; null with none. */
  episodeLine: string | null
  /** Null with no episode, or one not started that has no season and episode number. */
  status: BingeStatus | null
}

const statusOf = (media: MediaItem | null): BingeStatus | null => {
  if (media === null) return null
  if (progressOf(media) > 0) return { kind: BINGE_STATUS_KINDS.left, media }
  const { item } = media
  if (item?.type !== ITEM_TYPES.episode || item.season == null || item.episode == null) return null
  return { kind: BINGE_STATUS_KINDS.start, season: item.season, episode: item.episode }
}

/**
 * The facts a Binge card shows of a show: its year, how long the episode it is on runs, its two
 * leading stars, that episode's code and title, a synopsis, and how far along it is. The Binge
 * lists hold shows only, so a movie gets no facts of its own here.
 */
export const bingeCardFacts = ({ details, next, episode }: BingeCardFactsProps): BingeCardFacts => {
  const seconds = next?.duration ?? (details.runtime == null ? null : details.runtime * 60)
  return {
    year: details.year == null ? null : String(details.year),
    runtime: formatRuntime(seconds),
    stars: details.credits
      .filter((credit) => credit.job === CREDIT_JOBS.cast)
      .slice(0, STAR_COUNT)
      .map((credit) => credit.name),
    synopsis: episode?.summary ?? details.summary ?? null,
    episodeLine: next === null ? null : tileWords(next).line,
    status: statusOf(next),
  }
}
