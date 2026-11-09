import {
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  WATCHED_STATES,
  WATCH_TARGET_KINDS,
  canFavouriteIn,
} from '@raven/core'
import {
  useServerItemFavourite,
  useServerMediaMutations,
  useServerWatchedToggle,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'

import { itemWatchedStateOf } from '@/queries/itemWatched'
import type { AppQueries } from '@/queries/useAppQueries'
import { type BingeToggle, useBingeToggle } from '@/queries/useBinge'

/** A Watched mark: how much is watched, and the press that marks the rest or takes the mark off. */
type WatchedMark = ReturnType<typeof useServerWatchedToggle>

/** A Favourite mark: whether the title is one, and the press that marks or unmarks it. */
type FavouriteMark = { isOn: boolean; onToggle: (isMarked: boolean) => void }

/**
 * A show's or a season's marks, as its page and a card's menu both offer them: Watched over
 * every episode under it, Favourite where the server says it can be one, and for a show Binge.
 */
export type ItemMarks = {
  watched: WatchedMark
  favourite: FavouriteMark | null
  binge: BingeToggle | null
}

/** A movie's or an episode's marks: Watched, and Favourite unless its library is locked. */
export type VideoMarks = Pick<ItemMarks, 'watched' | 'favourite'>

type UseItemMarksProps = { session: AppQueries; details: ItemDetails }

/** The marks of a show or a season, each shown before the server answers. */
export const useItemMarks = ({ session, details }: UseItemMarksProps): ItemMarks => {
  const watched = useServerWatchedToggle({
    api: session.api,
    state: itemWatchedStateOf(details),
    targets: [{ kind: WATCH_TARGET_KINDS.item, id: details.id, libraryId: null }],
  })
  const favourite = useServerItemFavourite({ api: session.api, item: details })
  const binge = useBingeToggle(details.id)
  return {
    watched,
    favourite:
      details.favourite === null ? null : { isOn: details.favourite, onToggle: favourite.mutate },
    binge: details.type === ITEM_TYPES.show ? binge : null,
  }
}

type UseVideoMarksProps = { session: AppQueries; media: MediaItem }

/**
 * The marks of a movie or an episode, each shown before the server answers. A locked library's
 * videos are never marked favourites, but one marked before the library locked can be unmarked.
 */
export const useVideoMarks = ({ session, media }: UseVideoMarksProps): VideoMarks => {
  const { favourite, watched } = useServerMediaMutations({ api: session.api, media })
  const libraries = useQuery(session.queries.librariesQuery)
  const canFavourite =
    canFavouriteIn({ libraries: libraries.data ?? [], libraryId: media.libraryId }) ||
    media.favourite
  return {
    watched: {
      state: media.watched ? WATCHED_STATES.watched : WATCHED_STATES.unwatched,
      onToggle: () => watched.mutate(!media.watched),
    },
    favourite: canFavourite ? { isOn: media.favourite, onToggle: favourite.mutate } : null,
  }
}
