import { ITEM_TYPES, type ItemDetails, type Saga, episodeTag, seasonsOf } from '@raven/core'
import type { IconName } from '@raven/ui/iconDrawings'

import { ROUTE_TARGETS, type RouteTarget, itemTarget } from '@/routes'
import { ITEM_LINK_COPY } from '@/queries/copy'

/** Where a video's menu can go from it: an episode up to its show or its season, a movie to its saga. */
export const LINK_KINDS = { show: 'show', season: 'season', saga: 'saga' } as const

export type LinkKind = (typeof LINK_KINDS)[keyof typeof LINK_KINDS]

/** The icon an item page's button for each way up wears. */
export const LINK_ICONS = {
  [LINK_KINDS.show]: 'up',
  [LINK_KINDS.season]: 'up',
  [LINK_KINDS.saga]: 'covers',
} as const satisfies Record<LinkKind, IconName>

/**
 * One way up from a video, as a menu or an item page offers it: what it is called aloud, the few
 * words beside its icon (the show's name, a season's code, the saga's name), and where it goes.
 */
export type ItemLink = { kind: LinkKind; label: string; text: string; target: RouteTarget }

type EpisodeLinksOfProps = {
  details: ItemDetails
  /** The episode's show, once read; its seasons name the one this episode is in. */
  show: ItemDetails | null
}

/**
 * An episode's ways up: its show, and its season once the show's page has said which item
 * that is, since an episode names its season only by number. None for anything but an episode.
 */
const episodeLinksOf = ({ details, show }: EpisodeLinksOfProps): ItemLink[] => {
  if (details.type !== ITEM_TYPES.episode || details.show === null) return []
  const season =
    show === null ? undefined : seasonsOf(show).find((each) => each.season === details.season)
  return [
    {
      kind: LINK_KINDS.show,
      label: ITEM_LINK_COPY.goTo(details.show.title),
      text: details.show.title,
      target: itemTarget(details.show.id),
    },
    ...(season === undefined
      ? []
      : [
          {
            kind: LINK_KINDS.season,
            label: ITEM_LINK_COPY.goTo(season.title),
            text: episodeTag({ season: season.season, episode: null }) ?? season.title,
            target: itemTarget(season.id),
          },
        ]),
  ]
}

type SagaLinkOfProps = {
  itemId: number
  libraryId: number
  /** The library's sagas, once read; the web's `SagaLink` finds the movie's the same way. */
  sagas: readonly Saga[]
}

/** A movie's way to its saga, when it is in one. */
const sagaLinkOf = ({ itemId, libraryId, sagas }: SagaLinkOfProps): ItemLink[] => {
  const saga = sagas.find((each) => each.media.some((media) => (media.item?.id ?? null) === itemId))
  return saga === undefined
    ? []
    : [
        {
          kind: LINK_KINDS.saga,
          label: ITEM_LINK_COPY.viewSaga(saga.name),
          text: saga.name,
          target: { kind: ROUTE_TARGETS.saga, libraryId, sagaId: saga.tmdbId },
        },
      ]
}

type VideoLinksOfProps = {
  /** The video's page; null for a file with no page, which has no way up. */
  details: ItemDetails | null
  show: ItemDetails | null
  libraryId: number
  sagas: readonly Saga[]
}

/** The ways up from a video: an episode's show and season, or a movie's saga. */
export const videoLinksOf = ({
  details,
  show,
  libraryId,
  sagas,
}: VideoLinksOfProps): ItemLink[] => {
  if (details === null) return []
  if (details.type === ITEM_TYPES.movie) return sagaLinkOf({ itemId: details.id, libraryId, sagas })
  return episodeLinksOf({ details, show })
}
