/** The two Top Shelves an app shows: an invitation to sign in, or a shelf of titles. */
export const TOP_SHELF_KINDS = {
  signedOut: 'signedOut',
  titles: 'titles',
} as const

/**
 * How a shelf of titles is laid out: a full screen carousel (raven's Continue watching) or a row
 * of square tiles (Wren's latest releases).
 */
export const TOP_SHELF_LAYOUTS = {
  carousel: 'carousel',
  sectioned: 'sectioned',
} as const

export type TopShelfLayout = (typeof TOP_SHELF_LAYOUTS)[keyof typeof TOP_SHELF_LAYOUTS]

/** A picture on the server, with the headers its request carries: the server's cookies and the account's token. */
export type TopShelfPicture = { uri: string; headers: Record<string, string> }

/** One title on the shelf. The native side downloads `picture` into the shared container, and leaves out an item whose picture cannot be read. */
export type TopShelfItem = {
  /** Unique on its shelf; it also names the picture's file. */
  id: string
  title: string
  /** The line under the title on a carousel; a sectioned tile shows none. */
  summary: string | null
  picture: TopShelfPicture
  /** The deep link the remote's Play button opens; null for an item with nothing to play straight away. */
  playUrl: string | null
  /** The deep link pressing the item opens. */
  openUrl: string
}

/** The shelf shown while nobody is signed in: an invitation to sign in. */
export type TopShelfInvitation = {
  kind: typeof TOP_SHELF_KINDS.signedOut
  title: string
  /** Where pressing the invitation goes: the sign-in page. */
  openUrl: string
}

/** What the Top Shelf shows above the app's tile, as the app last wrote it. */
export type TopShelf =
  | TopShelfInvitation
  | {
      kind: typeof TOP_SHELF_KINDS.titles
      layout: TopShelfLayout
      /** The shelf's name: the words over each slide of a carousel, the heading over a row. */
      title: string
      items: readonly TopShelfItem[]
    }

/**
 * The shelf without what changes as the account's token is renewed, so writing the same titles
 * again with a fresh token is seen as no change and downloads nothing.
 */
export const topShelfKeyOf = (shelf: TopShelf): string =>
  shelf.kind === TOP_SHELF_KINDS.signedOut
    ? JSON.stringify(shelf)
    : JSON.stringify({
        ...shelf,
        items: shelf.items.map(({ picture, ...item }) => ({ ...item, picture: picture.uri })),
      })

/** A route's path as expo-router names it (`/play/[mediaId]`) and the params that fill it. */
type DeepLinkOfProps = {
  /** The app's URL scheme, `raven` or `wren-tv`. */
  scheme: string
  pathname: string
  params: Readonly<Record<string, string>>
}

const SEGMENT_PARAM = /^\[(.+)\]$/

/**
 * The deep link that opens a route from outside the app: each `[name]` segment of the path takes
 * its param, and the params left over ride in the query, as the router reads them back.
 */
export const deepLinkOf = ({ scheme, pathname, params }: DeepLinkOfProps): string => {
  const filled = pathname
    .split('/')
    .filter((segment) => segment !== '')
    .reduce<{ segments: string[]; used: string[] }>(
      ({ segments, used }, segment) => {
        const name = SEGMENT_PARAM.exec(segment)?.[1] ?? null
        const value = name === null ? null : (params[name] ?? null)
        if (name === null || value === null) return { segments: [...segments, segment], used }
        return { segments: [...segments, encodeURIComponent(value)], used: [...used, name] }
      },
      { segments: [], used: [] },
    )
  const query = new URLSearchParams(
    Object.entries(params).filter(([name]) => !filled.used.includes(name)),
  ).toString()
  const path = `${scheme}://${filled.segments.join('/')}`
  return query === '' ? path : `${path}?${query}`
}
