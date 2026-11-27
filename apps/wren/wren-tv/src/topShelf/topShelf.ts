import type { AlbumSummary } from '@raven/core'
import {
  TOP_SHELF_KINDS,
  TOP_SHELF_LAYOUTS,
  type TopShelf,
  type TopShelfInvitation,
  deepLinkOf,
} from '@raven/top-shelf/contract'
import { HOME_COPY, TOP_SHELF_COPY } from '@raven/wren'
import type { CoverOf } from '@raven/wren-native'
import { WREN_PAGES, WREN_ROUTES, pageHref } from '@raven/wren-native/headless'

import { WREN_TV_SCHEME } from '@/config/linkScheme'

/** How many covers the row holds: what the Top Shelf shows across the screen, and a few more to scroll to. */
export const TOP_SHELF_ALBUMS = 12

/** Signed out: the invitation, which opens sign-in. */
export const SIGNED_OUT_SHELF: TopShelfInvitation = {
  kind: TOP_SHELF_KINDS.signedOut,
  title: TOP_SHELF_COPY.signIn,
  openUrl: deepLinkOf({ scheme: WREN_TV_SCHEME, pathname: WREN_ROUTES.signIn, params: {} }),
}

type ReleasesShelfOfProps = { albums: readonly AlbumSummary[]; coverOf: CoverOf }

/**
 * Signed in: the latest releases of every music library, newest first, as a row of square
 * covers under Home's heading for them; selecting one opens its album. An album with no cover is
 * left off, since a tile is its cover.
 */
export const releasesShelfOf = ({ albums, coverOf }: ReleasesShelfOfProps): TopShelf => ({
  kind: TOP_SHELF_KINDS.titles,
  layout: TOP_SHELF_LAYOUTS.sectioned,
  title: HOME_COPY.latestReleases,
  items: albums.slice(0, TOP_SHELF_ALBUMS).flatMap((album) => {
    const cover = coverOf({ albumId: album.id, coverVersion: album.coverVersion })
    if (cover === null) return []
    return [
      {
        id: `album-${album.id}`,
        title: album.title,
        summary: null,
        picture: cover,
        playUrl: null,
        openUrl: deepLinkOf({
          scheme: WREN_TV_SCHEME,
          ...pageHref({ page: WREN_PAGES.album, id: album.id }),
        }),
      },
    ]
  }),
})
