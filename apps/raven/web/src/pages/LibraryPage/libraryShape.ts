import {
  type LibraryKind,
  type LibrarySettings,
  type MediaGroupBy,
  type MediaItem,
  type ShowEntry,
  groupMedia,
} from '@raven/core'
import type { MatchType } from '@/components/FixMatchDialog/FixMatchDialog'

/**
 * How a library's own type bends its settings, kept here in one place for
 * the page and its play order to share.
 */

/** What a library's files are matched to, for the cards' Fix match; null where nothing is. */
export const matchTypeOf = (kind: LibraryKind): MatchType | null =>
  kind === 'movies' ? 'movie' : kind === 'shows' ? 'show' : null

/**
 * The grouping the files are shown in, or null when they are not grouped: a
 * TV library's leftover files never are, and a library of no particular type
 * has no matches to group by.
 */
export const shownGrouping = (settings: LibrarySettings): MediaGroupBy | null => {
  if (settings.view !== 'grouped' || settings.kind === 'shows') return null
  return settings.groupBy === 'match' && settings.kind === 'other' ? 'resolution' : settings.groupBy
}

/** A library's listing: its shows (none outside a TV library), then the files listed as files. */
export type Listing = { shows: ShowEntry[]; files: MediaItem[] }

/**
 * What Play and Shuffle start: a show's next episode first, then the files
 * in the order the page shows them.
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
  const grouping = shownGrouping(settings)
  const shownFiles =
    grouping == null
      ? listing.files
      : groupMedia({ items: listing.files, by: grouping }).flatMap((group) => group.items)
  const choices = [...nextEpisodes, ...listing.files]
  return {
    playable: choices.length > 0,
    first: () => nextEpisodes.at(0) ?? shownFiles.at(0),
    random: () => choices.at(Math.floor(Math.random() * choices.length)),
  }
}
