/** The app's route paths, one per file under `app/`. */
export const APP_ROUTES = {
  home: '/',
  signIn: '/sign-in',
  item: '/item/[id]',
  library: '/library/[id]',
  play: '/play/[mediaId]',
  unlock: '/unlock',
} as const

/**
 * The params the routes carry, as `useLocalSearchParams` reads them: the ids their file names
 * hold, and an item page's library and file, which ride in its query as the web's `?library=`
 * and `?file=` do.
 */
export const APP_ROUTE_PARAMS = {
  id: 'id',
  library: 'library',
  file: 'file',
  mediaId: 'mediaId',
} as const

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const APP_SCREENS = {
  home: 'index',
  item: 'item/[id]',
  library: 'library/[id]',
  play: 'play/[mediaId]',
  unlock: 'unlock',
} as const

/** Where a card or a button takes the viewer: an item's page, or the player. */
export const ROUTE_TARGETS = { item: 'item', play: 'play' } as const

export type RouteTarget =
  | {
      kind: typeof ROUTE_TARGETS.item
      itemId: number
      /** The library whose files alone the page shows; null to let the page choose. */
      libraryId: number | null
      /** The file the page's Play starts, for a card a movie was split onto; null otherwise. */
      fileId: number | null
    }
  | { kind: typeof ROUTE_TARGETS.play; mediaId: number }

/** An item's page, with neither a library nor a file named. */
export const itemTarget = (itemId: number): RouteTarget => ({
  kind: ROUTE_TARGETS.item,
  itemId,
  libraryId: null,
  fileId: null,
})

/** A param's value, left out when there is none. */
const paramOf = ({ name, value }: { name: string; value: number | null }) =>
  value === null ? {} : { [name]: String(value) }

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
        params: { [APP_ROUTE_PARAMS.mediaId]: String(target.mediaId) },
      }
    default: {
      const unknown: never = target
      return unknown
    }
  }
}
