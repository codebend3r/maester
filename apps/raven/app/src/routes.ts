/** The app's route paths, one per file under `app/`. */
export const APP_ROUTES = {
  home: '/',
  signIn: '/sign-in',
  item: '/item/[id]',
  library: '/library/[id]',
  play: '/play/[mediaId]',
  album: '/album/[id]',
  artist: '/artist/[id]',
  playlist: '/playlist/[id]',
  nowPlaying: '/now-playing',
  search: '/search',
  favourites: '/favourites',
  settings: '/settings',
} as const

/**
 * The params the routes carry, as `useLocalSearchParams` reads them: the ids their file names
 * hold, an item page's library and file, which ride in its query as the web's `?library=`
 * and `?file=` do, the search a library opens on, as the web's `?q=`, and the spot the player
 * starts at, as the desktop's play link's `?at=`.
 */
export const APP_ROUTE_PARAMS = {
  id: 'id',
  library: 'library',
  file: 'file',
  mediaId: 'mediaId',
  query: 'q',
  at: 'at',
  from: 'from',
} as const

/** Where `?from=` starts the player: from the very beginning, whatever spot was saved. */
export const PLAY_FROM = { start: 'start' } as const

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const APP_SCREENS = {
  home: 'index',
  item: 'item/[id]',
  library: 'library/[id]',
  play: 'play/[mediaId]',
  album: 'album/[id]',
  artist: 'artist/[id]',
  playlist: 'playlist/[id]',
  nowPlaying: 'now-playing',
  search: 'search',
  favourites: 'favourites',
  settings: 'settings',
} as const

/**
 * Where a card or a link takes the viewer: an item's page, the player, a library, an album, an
 * artist or one of the account's playlists.
 */
export const ROUTE_TARGETS = {
  item: 'item',
  play: 'play',
  library: 'library',
  album: 'album',
  artist: 'artist',
  playlist: 'playlist',
} as const

export type RouteTarget =
  | {
      kind: typeof ROUTE_TARGETS.item
      itemId: number
      /** The library whose files alone the page shows; null to let the page choose. */
      libraryId: number | null
      /** The file the page's Play starts, for a card a movie was split onto; null otherwise. */
      fileId: number | null
    }
  | {
      kind: typeof ROUTE_TARGETS.play
      mediaId: number
      /** Where to start, in seconds, as Resume says; 0 starts where the server last saved. */
      at: number
      /** Starts at the very beginning, past any spot the server saved: Play from the beginning. */
      isFromStart?: boolean
    }
  | {
      kind: typeof ROUTE_TARGETS.library
      libraryId: number
      /** The search the library opens on, as the web's `?q=`; empty for none. */
      query: string
    }
  | { kind: typeof ROUTE_TARGETS.album; albumId: number }
  | { kind: typeof ROUTE_TARGETS.artist; artistId: number }
  | { kind: typeof ROUTE_TARGETS.playlist; playlistId: number }

/** An item's page, with neither a library nor a file named. */
export const itemTarget = (itemId: number): RouteTarget => ({
  kind: ROUTE_TARGETS.item,
  itemId,
  libraryId: null,
  fileId: null,
})

type ParamOfProps = { name: string; value: number | string | null }

/** A param's value, left out when there is none. */
const paramOf = ({ name, value }: ParamOfProps) =>
  value === null || value === '' ? {} : { [name]: String(value) }

/** A route and its params, as the router takes them. */
export type Href = {
  pathname: (typeof APP_ROUTES)[keyof typeof APP_ROUTES]
  params: Record<string, string>
}

/** Where `target` is, as the router takes it. */
export const hrefOf = (target: RouteTarget): Href => {
  switch (target.kind) {
    case ROUTE_TARGETS.item:
      return {
        pathname: APP_ROUTES.item,
        params: {
          [APP_ROUTE_PARAMS.id]: String(target.itemId),
          ...paramOf({ name: APP_ROUTE_PARAMS.library, value: target.libraryId }),
          ...paramOf({ name: APP_ROUTE_PARAMS.file, value: target.fileId }),
        },
      }
    case ROUTE_TARGETS.play:
      return {
        pathname: APP_ROUTES.play,
        params: {
          [APP_ROUTE_PARAMS.mediaId]: String(target.mediaId),
          ...paramOf({ name: APP_ROUTE_PARAMS.at, value: target.at > 0 ? target.at : null }),
          ...paramOf({
            name: APP_ROUTE_PARAMS.from,
            value: target.isFromStart === true ? PLAY_FROM.start : null,
          }),
        },
      }
    case ROUTE_TARGETS.library:
      return {
        pathname: APP_ROUTES.library,
        params: {
          [APP_ROUTE_PARAMS.id]: String(target.libraryId),
          ...paramOf({ name: APP_ROUTE_PARAMS.query, value: target.query }),
        },
      }
    case ROUTE_TARGETS.album:
      return {
        pathname: APP_ROUTES.album,
        params: { [APP_ROUTE_PARAMS.id]: String(target.albumId) },
      }
    case ROUTE_TARGETS.artist:
      return {
        pathname: APP_ROUTES.artist,
        params: { [APP_ROUTE_PARAMS.id]: String(target.artistId) },
      }
    case ROUTE_TARGETS.playlist:
      return {
        pathname: APP_ROUTES.playlist,
        params: { [APP_ROUTE_PARAMS.id]: String(target.playlistId) },
      }
    default: {
      const unknown: never = target
      return unknown
    }
  }
}

/** A spot in seconds a route param names; 0, the server's own spot, for anything but one. */
export const secondsOf = (param: unknown): number => {
  const seconds = typeof param === 'string' ? Number(param) : Number.NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

/** The search through every library, opened on `query`: what the viewer typed in a header's field. */
export const searchHrefOf = (query: string): Href => ({
  pathname: APP_ROUTES.search,
  params: paramOf({ name: APP_ROUTE_PARAMS.query, value: query }),
})
