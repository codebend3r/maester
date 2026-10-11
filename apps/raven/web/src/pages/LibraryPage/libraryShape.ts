import { type LibrarySettings, type MediaItem, type ShowEntry, groupMedia } from '@raven/core'

/** A library's listing: its shows (none outside a TV library), then the files listed as files. */
export type Listing = { shows: ShowEntry[]; files: MediaItem[] }

/**
 * What Play and Shuffle start: a show's next episode first, then the files
 * in the order the page shows them. The settings are coherent with the
 * library's type, so a grouped view is one its type can show.
 */
export const playQueue = ({
  settings,
  listing,
}: {
  settings: LibrarySettings
  listing: Listing
}): {
  playable: boolean
  first: () => MediaItem | undefined
  random: () => MediaItem | undefined
} => {
  const nextEpisodes = listing.shows.flatMap((entry) => entry.next ?? [])
  const shownFiles =
    settings.view === 'grouped'
      ? groupMedia({ items: listing.files, by: settings.groupBy }).flatMap((group) => group.items)
      : listing.files
  const choices = [...nextEpisodes, ...listing.files]
  return {
    playable: choices.length > 0,
    first: () => nextEpisodes.at(0) ?? shownFiles.at(0),
    random: () => choices.at(Math.floor(Math.random() * choices.length)),
  }
}
