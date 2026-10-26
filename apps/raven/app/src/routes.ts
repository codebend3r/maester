/** The app's route paths, one per file under `app/`. */
export const APP_ROUTES = {
  home: '/',
  signIn: '/sign-in',
  item: '/item/[id]',
  library: '/library/[id]',
  play: '/play/[mediaId]',
  search: '/search',
  settings: '/settings',
  unlock: '/unlock',
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
} as const

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const APP_SCREENS = {
  home: 'index',
  item: 'item/[id]',
  library: 'library/[id]',
  play: 'play/[mediaId]',
  search: 'search',
  settings: 'settings',
  unlock: 'unlock',
} as const

/** Where a card or a link takes the viewer: an item's page, the player, or a library. */
export const ROUTE_TARGETS = { item: 'item', play: 'play', library: 'library' } as const

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
    }
  | {
      kind: typeof ROUTE_TARGETS.library
      libraryId: number
      /** The search the library opens on, as the web's `?q=`; empty for none. */
      query: string
    }

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
type Href = {
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
