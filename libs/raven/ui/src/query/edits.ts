import type { QueryKey } from '@tanstack/react-query'
import {
  type AlbumDetails,
  type AlbumSummary,
  type Artist,
  type ArtistDetails,
  type Duplicate,
  type Duplicates,
  HOME_SHELF_TYPES,
  ITEM_TYPES,
  type HistoryEntry,
  type Home,
  type HomeSearch,
  type HomeShelf,
  type ItemChild,
  type ItemDetails,
  type ItemSummary,
  type Library,
  type LibrarySettings,
  type MediaItem,
  type PlaylistDetails,
  type PlaylistSummary,
  type PosterEntry,
  type Saga,
  type ShowListing,
  type Track,
  firstEpisodeIn,
  firstSeasonIn,
  episodesOf,
  seasonsOf,
} from '@raven/core'
import { type Edit, editAll, editKey } from '@/query/optimistic'
import { queryKeys } from '@/query/queryClient'

/**
 * What each change looks like in the cache before the server answers, named
 * for the change, as `invalidate.ts` names what is read again after it. Each
 * update hands back the very same data where it changes nothing, so a query
 * that does not hold what changed is left alone.
 */

type MapWhereProps<T> = {
  items: T[]
  matches: (item: T) => boolean
  change: (item: T) => T
}

/** `items` with `change` made to each one `matches`, or the very same list where none does. */
const mapWhere = <T>({ items, matches, change }: MapWhereProps<T>): T[] => {
  if (!items.some(matches)) return items
  return items.map((item) => (matches(item) ? change(item) : item))
}

type WithoutEntryProps = {
  entries: PosterEntry[]
  id: number
}

/** Poster entries without video `id`'s. */
export const withoutEntry = ({ entries, id }: WithoutEntryProps): PosterEntry[] =>
  entries.filter((entry) => entry.media.id !== id)

type WithoutIdProps<T> = { items: T[]; id: number }

/** `items` without the one whose `id` is `id`, or the very same list where none is. */
const withoutId = <T extends { id: number }>({ items, id }: WithoutIdProps<T>): T[] => {
  const kept = items.filter((item) => item.id !== id)
  return kept.length === items.length ? items : kept
}

type ItemFavouriteEditsProps = {
  item: ItemDetails
  favourite: boolean
}

/**
 * A show or season marked or unmarked as a favourite: its own page, and
 * the favourites, which an unmarked one leaves. A marked one joins them once
 * read again, since the page's details are not a card's summary.
 */
export const itemFavouriteEdits = ({ item, favourite }: ItemFavouriteEditsProps): Edit[] => [
  editKey<ItemDetails>({
    queryKey: queryKeys.item(item.id),
    update: (details) => (details.favourite === favourite ? details : { ...details, favourite }),
  }),
  editKey<ItemSummary[]>({
    queryKey: queryKeys.favouriteTitles,
    update: (titles) => (favourite ? titles : withoutId({ items: titles, id: item.id })),
  }),
]

type FavouriteEditsProps = {
  media: MediaItem
  favourite: boolean
}

/**
 * A video marked or unmarked as a favourite wherever a heart or its menu
 * shows it: its own record, its library's listings, files not matched and
 * In progress, home and its searches, its item's page, and the favourites, which an unmarked
 * one leaves. Its history, sagas and duplicates follow once read again.
 */
export const favouriteEdits = ({ media, favourite }: FavouriteEditsProps): Edit[] => {
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
              if (versions === details.versions) return details
              return { ...details, versions }
            },
          }),
        ]
      : []),
  ]
}

type WatchedEditsProps = {
  media: MediaItem
  watched: boolean
}

/**
 * A card marked watched or unwatched, wherever one of its files shows: the
 * same files as `favouriteEdits` reaches, plus sagas, duplicates, history
 * and the item's versions. Marking clears every resume spot on the card
 * either way, so the position goes to 0 and the card leaves In progress.
 * A card is the files of one movie that share it, else a file by itself.
 */
export const watchedEdits = ({ media, watched }: WatchedEditsProps): Edit[] => {
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
              if (versions === details.versions) return details
              return { ...details, versions }
            },
          }),
        ]
      : []),
  ]
}

type ItemWatchedEditsProps = {
  itemId: number
  watched: boolean
}

type MarkEpisodesProps = {
  details: ItemDetails
  watched: boolean
}

type MarkFileProps = {
  file: MediaItem | null
  watched: boolean
}

/** An episode's file marked as the episode was, and no longer holding a spot. */
const markFile = ({ file, watched }: MarkFileProps): MediaItem | null =>
  file === null ? null : { ...file, watched, position: 0 }

type MarkEpisodeProps = {
  child: ItemChild
  watched: boolean
}

const markEpisode = ({ child, watched }: MarkEpisodeProps): ItemChild => {
  if (child.type !== ITEM_TYPES.episode) return child
  return { ...child, watched, primary: markFile({ file: child.primary, watched }) }
}

/** A season's episodes, and the file each plays, marked as the season was. */
const markEpisodes = ({ details, watched }: MarkEpisodesProps): ItemDetails => {
  const children = mapWhere<ItemChild>({
    items: details.children,
    matches: (child) =>
      child.type === ITEM_TYPES.episode &&
      (child.watched !== watched || (child.primary?.position ?? 0) !== 0),
    change: (child) => markEpisode({ child, watched }),
  })
  return children === details.children ? details : { ...details, children }
}

type CountedProps = {
  episodeCount: number
  watched: boolean
}

/** How many of a season's episodes count as watched once it is marked. */
const countedOf = ({ episodeCount, watched }: CountedProps): number => (watched ? episodeCount : 0)

type MarkSeasonsProps = {
  details: ItemDetails
  watched: boolean
  seasonId?: number
}

/**
 * A show's seasons, each counted all watched or none; only the season
 * `seasonId` names when one is given.
 */
const markSeasons = ({ details, watched, seasonId }: MarkSeasonsProps): ItemDetails => {
  const isNamed = (child: ItemChild): boolean => seasonId === undefined || child.id === seasonId
  const children = mapWhere<ItemChild>({
    items: details.children,
    matches: (child) =>
      child.type === ITEM_TYPES.season &&
      isNamed(child) &&
      child.watchedCount !== countedOf({ episodeCount: child.episodeCount, watched }),
    change: (child) =>
      child.type === ITEM_TYPES.season
        ? { ...child, watchedCount: countedOf({ episodeCount: child.episodeCount, watched }) }
        : child,
  })
  return children === details.children ? details : { ...details, children }
}

type NextEditProps = { showId: number; first: ItemChild | undefined; watched: boolean }

/** The episode a show plays next: none once all is watched, the first again once none is. */
const nextEdit = ({ showId, first, watched }: NextEditProps): Edit =>
  editKey<MediaItem | null>({
    queryKey: queryKeys.nextEpisode(showId),
    update: (next) => {
      if (watched) return null
      if (first?.type !== ITEM_TYPES.episode) return next
      return first.primary ?? next
    },
  })

/**
 * A whole show or season marked watched or unwatched, from what its pages
 * already hold: the season's episodes, the show's seasons and counts, and
 * the episode a show plays next, which is none once all is watched and the
 * first again once none is. A title whose page is not cached is left to be
 * read again.
 */
export const itemWatchedEdits = ({ itemId, watched }: ItemWatchedEditsProps): Edit[] => [
  {
    plan: (queryClient) => {
      const details = queryClient.getQueryData<ItemDetails>(queryKeys.item(itemId))
      if (details === undefined) return []
      const edits: Edit[] = (() => {
        if (details.type === ITEM_TYPES.season) {
          const showId = details.show?.id ?? null
          return [
            editKey<ItemDetails>({
              queryKey: queryKeys.item(itemId),
              update: (held) => markEpisodes({ details: held, watched }),
            }),
            ...(showId === null
              ? []
              : [
                  editKey<ItemDetails>({
                    queryKey: queryKeys.item(showId),
                    update: (held) => markSeasons({ details: held, watched, seasonId: itemId }),
                  }),
                ]),
          ]
        }
        if (details.type === ITEM_TYPES.show) {
          const seasons = seasonsOf(details)
          const firstSeason = firstSeasonIn(seasons)
          const firstDetails =
            firstSeason === undefined
              ? undefined
              : queryClient.getQueryData<ItemDetails>(queryKeys.item(firstSeason.id))
          return [
            editKey<ItemDetails>({
              queryKey: queryKeys.item(itemId),
              update: (held) => markSeasons({ details: held, watched }),
            }),
            ...seasons.map((season) =>
              editKey<ItemDetails>({
                queryKey: queryKeys.item(season.id),
                update: (held) => markEpisodes({ details: held, watched }),
              }),
            ),
            nextEdit({
              showId: itemId,
              first:
                firstDetails === undefined ? undefined : firstEpisodeIn(episodesOf(firstDetails)),
              watched,
            }),
          ]
        }
        return []
      })()
      return edits.flatMap((change) => change.plan(queryClient))
    },
  },
]

type LibraryOrderEditsProps = { ids: readonly number[] }

/**
 * The libraries were put in the order of `ids`: the list the side menu and
 * the Libraries page read. A library `ids` leaves out follows the rest.
 */
export const libraryOrderEdits = ({ ids }: LibraryOrderEditsProps): Edit[] => [
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

type LibrarySettingsEditsProps = {
  libraryId: number
  change: Partial<LibrarySettings>
}

/** A library's settings changed: on its own page, and in the libraries list the side menu reads. */
export const librarySettingsEdits = ({ libraryId, change }: LibrarySettingsEditsProps): Edit[] => [
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

type MarkedEditsProps = {
  /** The album's or artist's page. */
  detailsKey: QueryKey
  /** The favourite albums or artists. */
  listKey: QueryKey
  id: number
  favourite: boolean
}

/**
 * An album or artist marked or unmarked as a favourite: its page, and its
 * favourites list, which an unmarked one leaves. A marked one joins it once
 * read again, as the list's order is the server's.
 */
const markedEdits = <Details extends { isFavourite: boolean }, Listed extends { id: number }>({
  detailsKey,
  listKey,
  id,
  favourite,
}: MarkedEditsProps): Edit[] => [
  editKey<Details>({
    queryKey: detailsKey,
    update: (details) =>
      details.isFavourite === favourite ? details : { ...details, isFavourite: favourite },
  }),
  editKey<Listed[]>({
    queryKey: listKey,
    update: (listed) => (favourite ? listed : withoutId({ items: listed, id })),
  }),
]

type AlbumFavouriteEditsProps = { albumId: number; favourite: boolean }

/** An album marked or unmarked as a favourite: its page, and the favourite albums. */
export const albumFavouriteEdits = ({ albumId, favourite }: AlbumFavouriteEditsProps): Edit[] =>
  markedEdits<AlbumDetails, AlbumSummary>({
    detailsKey: queryKeys.album(albumId),
    listKey: queryKeys.favouriteAlbums,
    id: albumId,
    favourite,
  })

type ArtistFavouriteEditsProps = { artistId: number; favourite: boolean }

/** An artist marked or unmarked as a favourite: their page, and the favourite artists. */
export const artistFavouriteEdits = ({ artistId, favourite }: ArtistFavouriteEditsProps): Edit[] =>
  markedEdits<ArtistDetails, Artist>({
    detailsKey: queryKeys.artist(artistId),
    listKey: queryKeys.favouriteArtists,
    id: artistId,
    favourite,
  })

type PlaylistRenameEditsProps = { id: number; name: string }

/** A playlist renamed: its page, and the list of the account's playlists. */
export const playlistRenameEdits = ({ id, name }: PlaylistRenameEditsProps): Edit[] => {
  const rename = (playlist: PlaylistSummary): PlaylistSummary =>
    playlist.name === name ? playlist : { ...playlist, name }
  return [
    editKey<PlaylistDetails>({
      queryKey: queryKeys.playlist(id),
      update: (details) => {
        const playlist = rename(details.playlist)
        return playlist === details.playlist ? details : { ...details, playlist }
      },
    }),
    editKey<PlaylistSummary[]>({
      queryKey: queryKeys.playlistList,
      update: (playlists) =>
        mapWhere({ items: playlists, matches: (playlist) => playlist.id === id, change: rename }),
    }),
  ]
}

type PlaylistTracksEditsProps = { id: number; tracks: readonly Track[] }

/**
 * A playlist's tracks put in a new order, or with one taken out: its page,
 * with its count and length, and its line in the list of playlists.
 */
export const playlistTracksEdits = ({ id, tracks }: PlaylistTracksEditsProps): Edit[] => {
  const trackCount = tracks.length
  const duration = tracks.reduce((total, track) => total + (track.duration ?? 0), 0)
  const recount = (playlist: PlaylistSummary): PlaylistSummary =>
    playlist.trackCount === trackCount && playlist.duration === duration
      ? playlist
      : { ...playlist, trackCount, duration }
  return [
    editKey<PlaylistDetails>({
      queryKey: queryKeys.playlist(id),
      update: (details) => ({
        playlist: recount(details.playlist),
        tracks: [...tracks],
      }),
    }),
    editKey<PlaylistSummary[]>({
      queryKey: queryKeys.playlistList,
      update: (playlists) =>
        mapWhere({ items: playlists, matches: (playlist) => playlist.id === id, change: recount }),
    }),
  ]
}
