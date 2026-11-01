import type { ItemSummary, PosterEntry } from '@raven/core'

import type { Picture } from '@/queries/cards'

/** The art of a show or film as its page names it: its title art, and its backdrop. */
export type ShowArt = { logo: Picture | null; backdrop: Picture | null }

/** The art of shows and films by item id, as `useShowArts` reads it. */
export type ShowArts = ReadonlyMap<number, ShowArt>

/**
 * The item whose art stands for `item`: an episode or season wears its show's, since only a
 * show or a film has title art and a backdrop, and the `poster` a server names for an episode
 * is its season.
 */
const showArtIdOf = (item: ItemSummary): number => item.show?.id ?? item.id

type ShowArtOfProps = { entry: PosterEntry; arts: ShowArts }

/** The art of the show or film a video belongs to; null for an unmatched video or art not read yet. */
export const showArtOf = ({ entry, arts }: ShowArtOfProps): ShowArt | null => {
  const { item } = entry.media
  return item === null ? null : (arts.get(showArtIdOf(item)) ?? null)
}

/** The title art of the show or film a video belongs to, null where it has none or it is not read yet. */
export const logoOf = ({ entry, arts }: ShowArtOfProps): Picture | null =>
  showArtOf({ entry, arts })?.logo ?? null

/** The shows and films a list of videos belong to, whose art their cards wear. */
export const showArtIdsOf = (entries: readonly PosterEntry[]): number[] =>
  entries.flatMap(({ media }) => (media.item === null ? [] : [showArtIdOf(media.item)]))
