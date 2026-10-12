import type { ItemSummary, Saga } from '@/contract'

/**
 * The backdrop a saga's page and deck show: that of its first movie with
 * one, oldest first, as its movies come; null when none has.
 */
export const sagaBackdrop = (
  saga: Saga,
): { id: ItemSummary['id']; version: NonNullable<ItemSummary['backdropVersion']> } | null =>
  saga.media.flatMap(({ item }) =>
    item?.backdropVersion == null ? [] : [{ id: item.id, version: item.backdropVersion }],
  )[0] ?? null
