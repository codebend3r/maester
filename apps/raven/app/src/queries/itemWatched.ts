import {
  ITEM_TYPES,
  type ItemDetails,
  type WatchedState,
  episodesOf,
  episodesWatched,
  seasonsOf,
  seasonsWatched,
  watchedStateOf,
} from '@raven/core'

/**
 * How much of an item is watched: a show by its seasons, a season by its episodes, a movie or
 * an episode by its files, as the item pages count them.
 */
export const itemWatchedStateOf = (details: ItemDetails): WatchedState => {
  switch (details.type) {
    case ITEM_TYPES.show:
      return watchedStateOf(seasonsWatched(seasonsOf(details)))
    case ITEM_TYPES.season:
      return watchedStateOf(episodesWatched(episodesOf(details)))
    case ITEM_TYPES.movie:
    case ITEM_TYPES.episode:
      return watchedStateOf({
        watched: details.versions.filter((file) => file.watched).length,
        total: details.versions.length,
      })
    default: {
      const unknown: never = details.type
      return unknown
    }
  }
}
