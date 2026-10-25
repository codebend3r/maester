import {
  type Duplicate,
  type Duplicates,
  HOME_SHELF_TYPES,
  type HistoryEntry,
  type Home,
  type HomeSearch,
  type HomeShelf,
  type ItemDetails,
  type ItemSummary,
  type Library,
  type LibrarySettings,
  type MediaItem,
  type PosterEntry,
  type Saga,
  type ShowListing,
} from '@raven/core'
import { type Edit, editAll, editKey } from '@/query/optimistic'
import { queryKeys } from '@/query/queryClient'

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
 * A show or season marked or unmarked as a favourite: its own page, and
 * the favourites, which an unmarked one leaves. A marked one joins them once
 * read again, since the page's details are not a card's summary.
 */
export const itemFavouriteEdits = ({
  item,
  favourite,
}: {
  item: ItemDetails
  favourite: boolean
}): Edit[] => [
  editKey<ItemDetails>({
    queryKey: queryKeys.item(item.id),
    update: (details) => (details.favourite === favourite ? details : { ...details, favourite }),
  }),
  editKey<ItemSummary[]>({
    queryKey: queryKeys.favouriteTitles,
    update: (titles) => {
      if (favourite) return titles
      const kept = titles.filter((title) => title.id !== item.id)
      return kept.length === titles.length ? titles : kept
    },
  }),
]

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
      matches: (shelf) => shelf.type === HOME_SHELF_TYPES.media && shelf.media.some(isVideo),
      change: (shelf) =>
        shelf.type === HOME_SHELF_TYPES.media ? { ...shelf, media: markAll(shelf.media) } : shelf,
    })
  const favourites = (entries: PosterEntry[]): PosterEntry[] => {
    if (favourite) return markEntries(entries)
    const kept = withoutEntry({ entries, id: media.id })
    return kept.length === entries.length ? entries : kept
  }
  const { libraryId } = media
  return [
    editKey<MediaItem>({ queryKey: queryKeys.mediaItem(media.id), update: mark }),
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
    editKey<MediaItem[]>({ queryKey: queryKeys.unmatched(libraryId), update: markAll }),
    editKey<PosterEntry[]>({ queryKey: queryKeys.inProgress(libraryId), update: markEntries }),
    editKey<PosterEntry[]>({ queryKey: queryKeys.favourites, update: favourites }),
    editKey<PosterEntry[]>({
      queryKey: queryKeys.libraryFavourites(libraryId),
      update: favourites,
    }),
    editKey<Home>({
      queryKey: queryKeys.home,
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
          editKey<ItemDetails>({
            queryKey: queryKeys.item(media.item.id),
            update: (details) => {
              const versions = markAll(details.versions)
              return versions === details.versions ? details : { ...details, versions }
            },
          }),
        ]
      : []),
  ]
}

/**
 * A card marked watched or unwatched, wherever one of its files shows: the
 * same files as `favouriteEdits` reaches, plus sagas, duplicates, history
 * and the item's versions. Marking clears every resume spot on the card
 * either way, so the position goes to 0 and the card leaves In progress.
 * A card is the files of one movie that share it, else a file by itself.
 */
export const watchedEdits = ({
  media,
  watched,
}: {
  media: MediaItem
  watched: boolean
}): Edit[] => {
  const { libraryId } = media
  const isOnCard = (item: MediaItem): boolean =>
    item.libraryId === libraryId &&
    (media.item == null
      ? item.id === media.id
      : item.item?.id === media.item.id && item.card === media.card)
  const needsMark = (item: MediaItem): boolean =>
    isOnCard(item) && (item.watched !== watched || item.position !== 0)
  const mark = (item: MediaItem): MediaItem => ({ ...item, watched, position: 0 })
  const markAll = (items: MediaItem[]): MediaItem[] =>
    mapWhere({ items, matches: needsMark, change: mark })
  const markEntries = (entries: PosterEntry[]): PosterEntry[] =>
    mapWhere({
      items: entries,
      matches: (entry) => needsMark(entry.media),
      change: (entry) => ({ ...entry, media: mark(entry.media) }),
    })
  const dropEntries = (entries: PosterEntry[]): PosterEntry[] => {
    const kept = entries.filter((entry) => !isOnCard(entry.media))
    return kept.length === entries.length ? entries : kept
  }
  const markShelves = (shelves: HomeShelf[]): HomeShelf[] =>
    mapWhere({
      items: shelves,
      matches: (shelf) => shelf.type === HOME_SHELF_TYPES.media && shelf.media.some(needsMark),
      change: (shelf) =>
        shelf.type === HOME_SHELF_TYPES.media ? { ...shelf, media: markAll(shelf.media) } : shelf,
    })
  const markHistory = (entries: HistoryEntry[]): HistoryEntry[] =>
    mapWhere({
      items: entries,
      matches: (entry) => needsMark(entry.media),
      change: (entry) => ({ ...entry, media: mark(entry.media) }),
    })
  const markSagas = (sagas: Saga[]): Saga[] =>
    mapWhere({
      items: sagas,
      matches: (saga) => saga.media.some(needsMark),
      change: (saga) => ({ ...saga, media: markAll(saga.media) }),
    })
  const markDuplicate = (duplicate: Duplicate): Duplicate => ({
    ...duplicate,
    cards: duplicate.cards.map((card) => ({
      entry: needsMark(card.entry.media)
        ? { ...card.entry, media: mark(card.entry.media) }
        : card.entry,
      files: mapWhere({
        items: card.files,
        matches: (file) => needsMark(file.media),
        change: (file) => ({ ...file, media: mark(file.media) }),
      }),
    })),
  })
  const markDuplicates = (duplicates: Duplicates): Duplicates =>
    mapWhere({
      items: duplicates,
      matches: (duplicate) =>
        duplicate.cards.some(
          (card) => needsMark(card.entry.media) || card.files.some((file) => needsMark(file.media)),
        ),
      change: markDuplicate,
    })
  return [
    editAll<MediaItem>({
      // A video's own record, not its tracks or subtitles, which share the prefix.
      filters: {
        queryKey: queryKeys.allMedia,
        predicate: (query) => query.queryKey.length === 2,
      },
      update: (item) => (needsMark(item) ? mark(item) : item),
    }),
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
    editKey<MediaItem[]>({ queryKey: queryKeys.unmatched(libraryId), update: markAll }),
    editKey<PosterEntry[]>({ queryKey: queryKeys.inProgress(libraryId), update: dropEntries }),
    editKey<PosterEntry[]>({ queryKey: queryKeys.favourites, update: markEntries }),
    editKey<PosterEntry[]>({
      queryKey: queryKeys.libraryFavourites(libraryId),
      update: markEntries,
    }),
    editKey<Home>({
      queryKey: queryKeys.home,
      update: (home) => {
        const inProgress = dropEntries(home.inProgress)
        const shelves = markShelves(home.shelves)
        return inProgress === home.inProgress && shelves === home.shelves
          ? home
          : { ...home, inProgress, shelves }
      },
    }),
    editAll<HomeSearch>({ filters: { queryKey: queryKeys.homeSearches }, update: markShelves }),
    editKey<Saga[]>({ queryKey: queryKeys.sagas(libraryId), update: markSagas }),
    editKey<Duplicates>({ queryKey: queryKeys.duplicates(libraryId), update: markDuplicates }),
    // The library's history, and the one across every library.
    editAll<HistoryEntry[]>({
      filters: { queryKey: queryKeys.historyLists(libraryId) },
      update: markHistory,
    }),
    editAll<HistoryEntry[]>({
      filters: { queryKey: queryKeys.historyLists(null) },
      update: markHistory,
    }),
    ...(media.item
      ? [
          editKey<ItemDetails>({
            queryKey: queryKeys.item(media.item.id),
            update: (details) => {
              const versions = markAll(details.versions)
              return versions === details.versions ? details : { ...details, versions }
            },
          }),
        ]
      : []),
  ]
}

/**
 * The libraries were put in the order of `ids`: the list the side menu and
 * the Libraries page read. A library `ids` leaves out follows the rest.
 */
export const libraryOrderEdits = ({ ids }: { ids: readonly number[] }): Edit[] => [
  editKey<Library[]>({
    queryKey: queryKeys.libraries,
    update: (libraries) => {
      const rank = (library: Library): number => {
        const place = ids.indexOf(library.id)
        return place === -1 ? ids.length : place
      }
      const ordered = libraries.toSorted((a, b) => rank(a) - rank(b))
      return ordered.every((library, index) => library === libraries[index]) ? libraries : ordered
    },
  }),
]

/** A library's settings changed: on its own page, and in the libraries list the side menu reads. */
export const librarySettingsEdits = ({
  libraryId,
  change,
}: {
  libraryId: number
  change: Partial<LibrarySettings>
}): Edit[] => [
  editKey<Library>({
    queryKey: queryKeys.library(libraryId),
    update: (library) => ({ ...library, settings: { ...library.settings, ...change } }),
  }),
  editKey<Library[]>({
    queryKey: queryKeys.libraries,
    update: (libraries) =>
      mapWhere({
        items: libraries,
        matches: (library) => library.id === libraryId,
        change: (library) => ({ ...library, settings: { ...library.settings, ...change } }),
      }),
  }),
]
