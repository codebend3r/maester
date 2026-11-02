import {
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type LibraryKind,
  type MediaItem,
  SESSION_KINDS,
  type Saga,
  matchTypeFor,
  sagaEntryKey,
  sagaFacts,
} from '@raven/core'

import {
  CARD_SHAPES,
  type Pictures,
  type ShelfCard,
  imageOf,
  movieCard,
  pictureAt,
} from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'
import { ROUTE_TARGETS, type RouteTarget } from '@/routes'

/** TMDB keeps collections of movies alone, so only a library matched to movies has sagas, as the web's tabs have it. */
export const hasSagas = (kind: LibraryKind): boolean => matchTypeFor(kind) === ITEM_TYPES.movie

type SagaCardProps = Pictures & { saga: Saga; libraryId: number }

/** A saga as a card: its first movie's poster, its name, and how many movies it holds over which years. */
const sagaCard = ({ saga, libraryId, api, headersFor }: SagaCardProps): ShelfCard => {
  const [first] = saga.media
  const uri =
    first === undefined
      ? null
      : (imageOf({ api, item: first.item, kind: ITEM_IMAGE_KINDS.poster }) ??
        api.thumbnailUrl(first))
  return {
    key: sagaEntryKey(saga),
    title: saga.name,
    line: sagaFacts(saga).join(', '),
    shape: CARD_SHAPES.poster,
    picture: pictureAt({ uri, headersFor }),
    progress: 0,
    target: { kind: ROUTE_TARGETS.saga, libraryId, sagaId: saga.tmdbId },
  }
}

const SECTION_KEYS = { sagas: 'sagas', films: 'films' } as const

type SagaSectionsOfProps = Pictures & { sagas: readonly Saga[]; libraryId: number }

/** A movie library's sagas as one run of cards, by name as the server sends them. */
export const sagaSectionsOf = ({
  sagas,
  libraryId,
  api,
  headersFor,
}: SagaSectionsOfProps): GridSection[] =>
  sagas.length === 0
    ? []
    : [
        {
          key: SECTION_KEYS.sagas,
          title: null,
          count: null,
          shape: CARD_SHAPES.poster,
          cards: sagas.map((saga) => sagaCard({ saga, libraryId, api, headersFor })),
        },
      ]

type SagaFilmsSectionsOfProps = Pictures & { saga: Saga }

/** A saga's movies as one run of posters, oldest first as the server sends them. */
export const sagaFilmsSectionsOf = ({
  saga,
  api,
  headersFor,
}: SagaFilmsSectionsOfProps): GridSection[] => [
  {
    key: SECTION_KEYS.films,
    title: null,
    count: null,
    shape: CARD_SHAPES.poster,
    cards: saga.media.map((media) => movieCard({ media, api, headersFor })),
  },
]

type SagaPlayTargetProps = {
  sagaId: Saga['tmdbId']
  media: readonly Pick<MediaItem, 'id' | 'watched'>[]
}

/**
 * Where Play all goes: the saga's first movie not yet watched, else its first, played in the
 * saga's session so the player's Next walks the rest; null for a saga with no movie.
 */
export const sagaPlayTarget = ({ sagaId, media }: SagaPlayTargetProps): RouteTarget | null => {
  const film = media.find((each) => !each.watched) ?? media[0]
  return film === undefined
    ? null
    : {
        kind: ROUTE_TARGETS.play,
        mediaId: film.id,
        at: 0,
        session: { kind: SESSION_KINDS.saga, sagaId },
      }
}
