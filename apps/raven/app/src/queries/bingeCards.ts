import {
  BINGE_STATUS_KINDS,
  type BingeStatus,
  ITEM_IMAGE_KINDS,
  type ItemDetails,
  type MediaItem,
  bingeCardFacts,
  episodeCode,
  pictureParts,
  progressOf,
} from '@raven/core'

import {
  CARD_SHAPES,
  CARD_SUBJECTS,
  type Pictures,
  type ShelfCard,
  pictureAt,
} from '@/queries/cards'
import { timeLeftOf } from '@/queries/timeLeft'
import { ROUTE_TARGETS, type RouteTarget } from '@/routes'

export const BINGE_COPY = {
  title: 'Binge',
  goTo: 'Go to',
  starring: 'Starring',
  separator: ' · ',
  listSeparator: ', ',
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

type JoinedOrNullProps = { parts: readonly (string | null)[]; separator: string }

const joinedOrNull = ({ parts, separator }: JoinedOrNullProps): string | null => {
  const words = parts.filter((part): part is string => part !== null && part !== '')
  return words.length === 0 ? null : words.join(separator)
}

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
  }
}

/** What a screen reader says of a binge card's title art, which opens the show's page. */
export const bingeArtLabelOf = (card: Pick<BingeCard, 'title'>): string =>
  `${BINGE_COPY.goTo} ${card.title}`
