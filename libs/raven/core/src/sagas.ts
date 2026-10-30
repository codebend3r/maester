import {
  type ItemSummary,
  SAGA_BACKDROP_TYPES,
  type Saga,
  WATCH_TARGET_KINDS,
  type WatchTarget,
} from '@/contract'
import { formatRuntime } from '@/format'
import { plural } from '@/plural'

/** A movie's backdrop, by the item it belongs to and the version that names the picture, and the movie's title. */
export type SagaPicture = {
  id: ItemSummary['id']
  version: NonNullable<ItemSummary['backdropVersion']>
  title: ItemSummary['title']
}

/**
 * The backdrop of each of a saga's movies that has one, oldest first, as
 * its movies come: what its slideshow shows in turn, and what its cover
 * can be.
 */
export const sagaPictures = (saga: Saga): SagaPicture[] =>
  saga.media.flatMap(({ item }) =>
    item?.backdropVersion == null
      ? []
      : [{ id: item.id, version: item.backdropVersion, title: item.title }],
  )

/**
 * A saga's cover: the one backdrop that stands for it, behind the page as
 * its deck is pointed at, and on its page when it holds one still. The
 * movie's picked, while that movie is still in the saga, else its first
 * movie's with one; null when none has.
 */
export const sagaCover = (saga: Saga): SagaPicture | null => {
  const pictures = sagaPictures(saga)
  const { backdrop } = saga
  const picked =
    backdrop.type === SAGA_BACKDROP_TYPES.still
      ? pictures.find((picture) => picture.id === backdrop.itemId)
      : null
  return picked ?? pictures[0] ?? null
}

/** ["3 movies", "2002 to 2026"]: how many of the saga are here, and the years they span. */
export const sagaFacts = (saga: Saga): string[] => {
  const years = saga.media.flatMap((media) => media.item?.year ?? [])
  const first = Math.min(...years)
  const last = Math.max(...years)
  const range = first === last ? String(first) : `${first} to ${last}`
  const span = years.length === 0 ? [] : [range]
  return [plural({ n: saga.media.length, one: 'movie', many: 'movies' }), ...span]
}

/**
 * "20h 14m in all": the saga watched end to end, by the length of each
 * movie's file shown; null until any of them has been probed.
 */
export const sagaRuntime = (saga: Saga): string | null => {
  const total = formatRuntime(saga.media.reduce((sum, media) => sum + (media.duration ?? 0), 0))
  return total && `${total} in all`
}

type SagaPathProps = { libraryId: number; saga: Saga }

/** A saga's own page, under its library's. */
export const sagaPath = ({ libraryId, saga }: SagaPathProps): string =>
  `/libraries/${libraryId}/sagas/${encodeURIComponent(saga.tmdbId)}`

type SagaTargetsProps = {
  saga: Saga
  libraryId: number
}

/** A saga's movies as targets: each by its item in the saga's library, else its own file. */
export const sagaTargets = ({ saga, libraryId }: SagaTargetsProps): WatchTarget[] =>
  saga.media.map((media) =>
    media.item
      ? { kind: WATCH_TARGET_KINDS.item, id: media.item.id, libraryId }
      : { kind: WATCH_TARGET_KINDS.media, id: media.id },
  )
