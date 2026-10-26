import {
  LIBRARY_VIEWS,
  type LibrarySettings,
  type MediaItem,
  SHUFFLE_LENGTH,
  type ShowEntry,
  groupMedia,
  shuffled,
} from '@raven/core'

/** A library's listing: its shows (none outside a TV library), then the files listed as files. */
export type Listing = { shows: ShowEntry[]; files: MediaItem[] }

export const LISTING_STATES = { pending: 'pending', failed: 'failed', listed: 'listed' } as const

/** Where a listing stands: on its way, failed with nothing to show, or read. */
export type ListingState =
  | { state: typeof LISTING_STATES.pending }
  | { state: typeof LISTING_STATES.failed; error: Error }
  | ({ state: typeof LISTING_STATES.listed } & Listing)

/** What Play, Shuffle and the jump strip see while nothing is listed yet. */
export const NOTHING_LISTED: Listing = { shows: [], files: [] }

type PlayQueueProps = {
  settings: LibrarySettings
  listing: Listing
}

/**
 * What Play and Shuffle start: a show's next episode first, then the files
 * in the order the page shows them. Shuffle deals every show's next episode
 * and every file, and lines up `SHUFFLE_LENGTH` of them to play one after
 * another. The settings are coherent with the library's type, so a grouped
 * view is one its type can show.
 */
export const playQueue = ({
  settings,
  listing,
}: PlayQueueProps): {
  playable: boolean
  first: () => MediaItem | undefined
  shuffled: () => MediaItem[]
} => {
  const nextEpisodes = listing.shows.flatMap((entry) => entry.next ?? [])
  const shownFiles =
    settings.view === LIBRARY_VIEWS.grouped
      ? groupMedia({ items: listing.files, by: settings.groupBy }).flatMap((group) => group.items)
      : listing.files
  const choices = [...nextEpisodes, ...listing.files]
  return {
    playable: choices.length > 0,
    first: () => nextEpisodes.at(0) ?? shownFiles.at(0),
    shuffled: () => shuffled({ items: choices }).slice(0, SHUFFLE_LENGTH),
  }
}
