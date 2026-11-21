import {
  BINGE_STATUS_KINDS,
  type BingeSeen,
  type BingeStatus,
  ITEM_IMAGE_KINDS,
  type ItemDetails,
  type MediaItem,
  bingeCardFacts,
  episodeCode,
  mediaLabel,
  pictureParts,
  progressOf,
} from '@raven/core'

import {
  CARD_SHAPES,
  CARD_SUBJECTS,
  type Picture,
  type Pictures,
  type ShelfCard,
  pictureAt,
} from '@/queries/cards'
import { joinedOrNull } from '@/queries/lines'
import { timeLeftOf } from '@/queries/timeLeft'
import { ROUTE_TARGETS, type RouteTarget } from '@/routes'

type StartProps = { season: number; episode: number }

export const BINGE_COPY = {
  title: 'Binge',
  goTo: 'Go to',
  starring: 'Starring',
  separator: ' · ',
  listSeparator: ', ',
  play: 'Play',
  /** What a row says of a show not started, the web's words; a card has room only for the code. */
  start: ({ season, episode }: StartProps) => `Start season ${season} episode ${episode}`,
  /** How much of a show is watched, as the web's Binge row words it. */
  episodesSeen: ({ watched, total }: BingeSeen) =>
    `${watched} of ${total} ${total === 1 ? 'episode' : 'episodes'}`,
  percentSeen: (percent: number) => `${percent}%`,
  seenLabel: ({ watched, total }: BingeSeen) => `${watched} of ${total} episodes watched`,
} as const

/**
 * A binged show as Home's Binge section draws it, the web's Binge card's facts: its year and
 * length, the episode it is on, its two leading stars, a synopsis, the picture's quality as chips,
 * how far into the episode it is, and the way to the show's page.
 */
export type BingeCard = ShelfCard & {
  /** The year and the length, `2022 · 54m`; null with neither. */
  meta: string | null
  /** The episode it is on, `S01E02 · Half Loop`; null with none. */
  episodeLine: string | null
  /** The two leading stars, `A, B`, which a layout puts after `BINGE_COPY.starring`; null with no cast. */
  stars: string | null
  /** The episode's synopsis, else the show's; null when neither has one. */
  synopsis: string | null
  /** What is left of the episode, or the code of the one it starts on; null with none. */
  status: string | null
  /** The show's page, which the title art opens. */
  page: RouteTarget
  /** The show's poster, which the Binge page's row wears; null with none. */
  poster: Picture | null
  /** What a row says of the episode: what is left of it, or "Start season 1 episode 2"; null with none. */
  rowStatus: string | null
  /** What the row's resume button is called aloud, "Play" and the episode's own label; null with no episode left. */
  playLabel: string | null
  /** How many of the show's episodes on disk are watched, of how many; null with none on disk. */
  seen: BingeSeen | null
}

/** "23m left" once started, else the code of the episode it starts on, "S01E02", as a card has room for. */
const statusWordsOf = (status: BingeStatus | null): string | null => {
  if (status === null) return null
  switch (status.kind) {
    case BINGE_STATUS_KINDS.left:
      return timeLeftOf(status.media)
    case BINGE_STATUS_KINDS.start:
      return episodeCode({ season: status.season, episode: status.episode })
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

/** A row's words for the episode, the web's: "23m left" once started, else "Start season 1 episode 2". */
const rowStatusOf = (status: BingeStatus | null): string | null =>
  status !== null && status.kind === BINGE_STATUS_KINDS.start
    ? BINGE_COPY.start({ season: status.season, episode: status.episode })
    : statusWordsOf(status)

type BingeCardOfProps = Pictures & {
  show: ItemDetails
  /** The episode the show is on, as the server names it; null when none is left or not read yet. */
  next: MediaItem | null
  /** That episode's own page, for its synopsis; null until read. */
  episode: ItemDetails | null
}

/**
 * A binged show on its backdrop with its title art and the web Binge card's facts. Pressed, it
 * plays the episode it is on where it stopped; with none left it opens the show's page.
 */
export const bingeCardOf = ({
  show,
  next,
  episode,
  api,
  headersFor,
}: BingeCardOfProps): BingeCard => {
  const page: RouteTarget = {
    kind: ROUTE_TARGETS.item,
    itemId: show.id,
    libraryId: null,
    fileId: null,
  }
  const backdrop = pictureAt({
    uri: api.itemImageUrl({
      id: show.id,
      kind: ITEM_IMAGE_KINDS.backdrop,
      version: show.backdropVersion,
    }),
    headersFor,
  })
  const thumbnail = next === null ? null : pictureAt({ uri: api.thumbnailUrl(next), headersFor })
  const facts = bingeCardFacts({ details: show, next, episode })
  return {
    key: `binge:${show.id}`,
    title: show.title,
    line: null,
    shape: CARD_SHAPES.wide,
    picture: backdrop ?? thumbnail,
    progress: next === null ? 0 : progressOf(next),
    logo: pictureAt({
      uri: api.itemImageUrl({
        id: show.id,
        kind: ITEM_IMAGE_KINDS.logo,
        version: show.logoVersion,
      }),
      headersFor,
    }),
    chips: next === null ? [] : pictureParts(next),
    resume: null,
    subject: { kind: CARD_SUBJECTS.item, itemId: show.id },
    // A show being binged has episodes left, so it never wears the check.
    isWatched: false,
    target: next === null ? page : { kind: ROUTE_TARGETS.play, mediaId: next.id, at: 0 },
    meta: joinedOrNull({ parts: [facts.year, facts.runtime], separator: BINGE_COPY.separator }),
    episodeLine: facts.episodeLine,
    stars: facts.stars.length === 0 ? null : facts.stars.join(BINGE_COPY.listSeparator),
    synopsis: facts.synopsis,
    status: statusWordsOf(facts.status),
    page,
    poster: pictureAt({
      uri: api.itemImageUrl({
        id: show.id,
        kind: ITEM_IMAGE_KINDS.poster,
        version: show.posterVersion,
      }),
      headersFor,
    }),
    rowStatus: rowStatusOf(facts.status),
    playLabel: next === null ? null : `${BINGE_COPY.play} ${mediaLabel(next)}`,
    seen: facts.seen,
  }
}

/** The share of a show that is watched, from 0 to 1. */
export const seenShareOf = ({ watched, total }: BingeSeen): number =>
  total > 0 ? watched / total : 0

/** "3 of 9 episodes · 33%", as the web's Binge row says beside its bar. */
export const seenWordsOf = (seen: BingeSeen): string =>
  [BINGE_COPY.episodesSeen(seen), BINGE_COPY.percentSeen(Math.round(seenShareOf(seen) * 100))].join(
    BINGE_COPY.separator,
  )

/** What a screen reader says of a binge card's title art, which opens the show's page. */
export const bingeArtLabelOf = (card: Pick<BingeCard, 'title'>): string =>
  `${BINGE_COPY.goTo} ${card.title}`
