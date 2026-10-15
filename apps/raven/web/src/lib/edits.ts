import type {
  HomeSearch,
  HomeShelf,
  LibrarySettings,
  MediaItem,
  PosterEntry,
  ShowListing,
} from '@raven/core'
import { type Edit, edit, editAll } from '@/lib/optimistic'
import {
  favouritesQuery,
  homeQuery,
  inProgressQuery,
  itemQuery,
  librariesQuery,
  libraryFavouritesQuery,
  libraryQuery,
  mediaQuery,
  unmatchedQuery,
} from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'

/**
 * What each change looks like in the cache before the server answers, named
 * for the change, as `invalidate.ts` names what is read again after it. Each
 * update hands back the very same data where it changes nothing, so a query
 * that does not hold what changed is left alone.
 */

/** `items` with `change` made to each one `matches`, or the very same list where none does. */
const mapWhere = <T>({
  items,
  matches,
  change,
}: {
  items: T[]
  matches: (item: T) => boolean
  change: (item: T) => T
}): T[] =>
  items.some(matches) ? items.map((item) => (matches(item) ? change(item) : item)) : items

/** Poster entries without video `id`'s. */
export const withoutEntry = ({
  entries,
  id,
}: {
  entries: PosterEntry[]
  id: number
}): PosterEntry[] => entries.filter((entry) => entry.media.id !== id)

/**
 * A video marked or unmarked as a favourite wherever a heart or its menu
 * shows it: its own record, its library's listings, files not matched and
 * In progress, home and its searches, its item's page, and the favourites, which an unmarked
 * one leaves. Its history, sagas and duplicates follow once read again.
 */
export const favouriteEdits = ({
  media,
  favourite,
}: {
  media: MediaItem
  favourite: boolean
}): Edit[] => {
  const isVideo = (item: MediaItem): boolean => item.id === media.id
  const mark = (item: MediaItem): MediaItem => ({ ...item, favourite })
  const markAll = (items: MediaItem[]): MediaItem[] =>
    mapWhere({ items, matches: isVideo, change: mark })
  const markEntries = (entries: PosterEntry[]): PosterEntry[] =>
    mapWhere({
      items: entries,
      matches: (entry) => isVideo(entry.media),
      change: (entry) => ({ ...entry, media: mark(entry.media) }),
    })
  const markShelves = (shelves: HomeShelf[]): HomeShelf[] =>
    mapWhere({
      items: shelves,
      matches: (shelf) => shelf.type === 'media' && shelf.media.some(isVideo),
      change: (shelf) =>
        shelf.type === 'media' ? { ...shelf, media: markAll(shelf.media) } : shelf,
    })
  const favourites = (entries: PosterEntry[]): PosterEntry[] => {
    if (favourite) return markEntries(entries)
    const kept = withoutEntry({ entries, id: media.id })
    return kept.length === entries.length ? entries : kept
  }
  const { libraryId } = media
  return [
    edit({ queryKey: mediaQuery(media.id).queryKey, update: mark }),
    editAll<MediaItem[]>({
      filters: { queryKey: queryKeys.mediaLists(libraryId) },
      update: markAll,
    }),
    editAll<ShowListing>({
      filters: { queryKey: queryKeys.showLists(libraryId) },
      update: (listing) => {
        const unmatched = markAll(listing.unmatched)
        return unmatched === listing.unmatched ? listing : { ...listing, unmatched }
      },
    }),
    edit({ queryKey: unmatchedQuery(libraryId).queryKey, update: markAll }),
    edit({ queryKey: inProgressQuery(libraryId).queryKey, update: markEntries }),
    edit({ queryKey: favouritesQuery.queryKey, update: favourites }),
    edit({ queryKey: libraryFavouritesQuery(libraryId).queryKey, update: favourites }),
    edit({
      queryKey: homeQuery.queryKey,
      update: (home) => {
        const inProgress = markEntries(home.inProgress)
        const shelves = markShelves(home.shelves)
        return inProgress === home.inProgress && shelves === home.shelves
          ? home
          : { ...home, inProgress, shelves }
      },
    }),
    editAll<HomeSearch>({ filters: { queryKey: queryKeys.homeSearches }, update: markShelves }),
    ...(media.item
      ? [
          edit({
            queryKey: itemQuery(media.item.id).queryKey,
            update: (details) => {
              const versions = markAll(details.versions)
              return versions === details.versions ? details : { ...details, versions }
            },
          }),
        ]
      : []),
  ]
}

/** A library's settings changed: on its own page, and in the libraries list the side menu reads. */
export const librarySettingsEdits = ({
  libraryId,
  change,
}: {
  libraryId: number
  change: Partial<LibrarySettings>
}): Edit[] => [
  edit({
    queryKey: libraryQuery(libraryId).queryKey,
    update: (library) => ({ ...library, settings: { ...library.settings, ...change } }),
  }),
  edit({
    queryKey: librariesQuery.queryKey,
    update: (libraries) =>
      mapWhere({
        items: libraries,
        matches: (library) => library.id === libraryId,
        change: (library) => ({ ...library, settings: { ...library.settings, ...change } }),
      }),
  }),
]
