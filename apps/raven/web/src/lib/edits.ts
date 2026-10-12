import type {
  Home,
  ItemDetails,
  Library,
  LibrarySettings,
  MediaItem,
  PosterEntry,
  ShowListing,
} from '@raven/core'
import { type Edit, edit } from '@/lib/optimistic'
import { queryKeys } from '@/lib/queryClient'

/**
 * What each change looks like in the cache before the server answers, named
 * for the change, as `invalidate.ts` names what is read again after it.
 */

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
 * In progress, home, its item's page, and the favourites, which an unmarked
 * one leaves. Its history, sagas and duplicates follow once read again.
 */
export const favouriteEdits = ({
  media,
  favourite,
}: {
  media: MediaItem
  favourite: boolean
}): Edit[] => {
  const mark = (item: MediaItem): MediaItem =>
    item.id === media.id ? { ...item, favourite } : item
  const markEntry = (entry: PosterEntry): PosterEntry =>
    entry.media.id === media.id ? { ...entry, media: mark(entry.media) } : entry
  const favourites = (entries: PosterEntry[]): PosterEntry[] =>
    favourite ? entries.map(markEntry) : withoutEntry({ entries, id: media.id })
  const markAll = (items: MediaItem[]): MediaItem[] => items.map(mark)
  const { libraryId } = media
  return [
    edit<MediaItem>({
      filters: { queryKey: queryKeys.mediaItem(media.id), exact: true },
      update: mark,
    }),
    edit<MediaItem[]>({ filters: { queryKey: queryKeys.mediaLists(libraryId) }, update: markAll }),
    edit<MediaItem[]>({
      filters: { queryKey: queryKeys.unmatched(libraryId), exact: true },
      update: markAll,
    }),
    edit<ShowListing>({
      filters: { queryKey: queryKeys.showLists(libraryId) },
      update: (listing) => ({ ...listing, unmatched: markAll(listing.unmatched) }),
    }),
    edit<PosterEntry[]>({
      filters: { queryKey: queryKeys.inProgress(libraryId), exact: true },
      update: (entries) => entries.map(markEntry),
    }),
    edit<PosterEntry[]>({
      filters: { queryKey: queryKeys.favourites, exact: true },
      update: favourites,
    }),
    edit<PosterEntry[]>({
      filters: { queryKey: queryKeys.libraryFavourites(libraryId), exact: true },
      update: favourites,
    }),
    edit<Home>({
      filters: { queryKey: queryKeys.home, exact: true },
      update: (home) => ({
        ...home,
        inProgress: home.inProgress.map(markEntry),
        shelves: home.shelves.map((shelf) =>
          shelf.type === 'media' ? { ...shelf, media: markAll(shelf.media) } : shelf,
        ),
      }),
    }),
    ...(media.item
      ? [
          edit<ItemDetails>({
            filters: { queryKey: queryKeys.item(media.item.id), exact: true },
            update: (details) => ({ ...details, versions: markAll(details.versions) }),
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
}): Edit[] => {
  const changed = (library: Library): Library =>
    library.id === libraryId
      ? { ...library, settings: { ...library.settings, ...change } }
      : library
  return [
    edit<Library>({
      filters: { queryKey: queryKeys.library(libraryId), exact: true },
      update: changed,
    }),
    edit<Library[]>({
      filters: { queryKey: queryKeys.libraries, exact: true },
      update: (libraries) => libraries.map(changed),
    }),
  ]
}
