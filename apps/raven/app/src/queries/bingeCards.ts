import {
  CREDIT_JOBS,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  formatRuntime,
  pictureParts,
  progressOf,
  tileWords,
} from '@raven/core'

import { CARD_SHAPES, type Pictures, type ShelfCard, pictureAt } from '@/queries/cards'
import { timeLeftOf } from '@/queries/timeLeft'
import { ROUTE_TARGETS, type RouteTarget } from '@/routes'

type StartProps = { season: number; episode: number }

export const BINGE_COPY = {
  title: 'Binge',
  goTo: 'Go to',
  starring: 'Starring',
  separator: ' · ',
  listSeparator: ', ',
  start: ({ season, episode }: StartProps) => `Start season ${season} episode ${episode}`,
} as const

/** How many of the cast the card names, as the web's. */
const STAR_COUNT = 2

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
  /** `Starring A, B`; null with no cast. */
  starring: string | null
  /** The episode's synopsis, else the show's; null when neither has one. */
  synopsis: string | null
  /** What is left of the episode, or which one it starts on; null with none. */
  status: string | null
  /** The show's page, which the title art opens. */
  page: RouteTarget
}

/** "23m left" once started, else "Start season 1 episode 2" for an episode not yet started. */
const statusOf = (media: MediaItem | null): string | null => {
  if (media === null) return null
  if (progressOf(media) > 0) return timeLeftOf(media)
  const { item } = media
  if (item?.type !== ITEM_TYPES.episode || item.season == null || item.episode == null) return null
  return BINGE_COPY.start({ season: item.season, episode: item.episode })
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
  const seconds = next?.duration ?? (show.runtime == null ? null : show.runtime * 60)
  const stars = show.credits
    .filter((credit) => credit.job === CREDIT_JOBS.cast)
    .slice(0, STAR_COUNT)
    .map((credit) => credit.name)
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
    target: next === null ? page : { kind: ROUTE_TARGETS.play, mediaId: next.id, at: 0 },
    meta: joinedOrNull({
      parts: [show.year == null ? null : String(show.year), formatRuntime(seconds)],
      separator: BINGE_COPY.separator,
    }),
    episodeLine: next === null ? null : tileWords(next).line,
    starring:
      stars.length === 0 ? null : `${BINGE_COPY.starring} ${stars.join(BINGE_COPY.listSeparator)}`,
    synopsis: episode?.summary ?? show.summary ?? null,
    status: statusOf(next),
    page,
  }
}

/** What a screen reader says of a binge card's title art, which opens the show's page. */
export const bingeArtLabelOf = (card: Pick<BingeCard, 'title'>): string =>
  `${BINGE_COPY.goTo} ${card.title}`
