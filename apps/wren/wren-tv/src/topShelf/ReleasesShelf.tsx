import { type SignedInShelfProps, useTopShelf } from '@raven/top-shelf'
import { RECENT_SORTS } from '@raven/wren'
import { type WrenSession, useCovers, useRecentAlbums } from '@raven/wren-native'

import { TOP_SHELF_ALBUMS, releasesShelfOf } from '@/topShelf/topShelf'

/*
 * Keeps Wren's Top Shelf on the latest releases once every music library has answered. It is
 * built afresh each render, as `coverOf` is; `useTopShelf` writes it only when its titles change.
 */
export function ReleasesShelf({ session }: SignedInShelfProps<WrenSession>) {
  const { coverOf } = useCovers(session)
  const { albums, listing } = useRecentAlbums({
    session,
    sort: RECENT_SORTS.release,
    limit: TOP_SHELF_ALBUMS,
  })
  useTopShelf(listing.isRead ? releasesShelfOf({ albums, coverOf }) : null)
  return null
}
