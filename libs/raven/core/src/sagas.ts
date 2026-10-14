import type { ItemSummary, Saga } from '@/contract'

/** A movie's backdrop, by the item it belongs to and the version that names the picture, and the movie's title. */
export type SagaPicture = {
  id: ItemSummary['id']
  version: NonNullable<ItemSummary['backdropVersion']>
  title: ItemSummary['title']
}

/**
 * The backdrop of each of a saga's movies that has one, oldest first, as
 * its movies come: what its slideshow shows in turn, and what can be held
 * still in its place.
 */
export const sagaPictures = (saga: Saga): SagaPicture[] =>
  saga.media.flatMap(({ item }) =>
    item?.backdropVersion == null
      ? []
      : [{ id: item.id, version: item.backdropVersion, title: item.title }],
  )

/**
 * The one backdrop that stands for a saga, on its deck and on its page
 * when it holds one still: the movie's picked, while that movie is still
 * in the saga, else its first movie's with one; null when none has.
 */
export const sagaBackdrop = (saga: Saga): SagaPicture | null => {
  const pictures = sagaPictures(saga)
  const { backdrop } = saga
  const picked =
    backdrop.type === 'still' ? pictures.find((picture) => picture.id === backdrop.itemId) : null
  return picked ?? pictures[0] ?? null
}
