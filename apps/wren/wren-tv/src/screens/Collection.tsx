import { oneOf, orElse } from '@raven/core'
import { LIBRARY_SEGMENTS, SHARED_ORDER, type SharedSegment } from '@raven/wren'
import { useLocalSearchParams } from 'expo-router'
import type { ComponentType } from 'react'

import { type WrenSession, useWren } from '@raven/wren-native'
import { WREN_ROUTE_PARAMS } from '@raven/wren-native/headless'
import { AlbumsCollection } from '@/screens/library/AlbumsCollection'
import { ArtistsCollection } from '@/screens/library/ArtistsCollection'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { FavouritesCollection } from '@/screens/library/FavouritesCollection'
import { PlaylistsCollection } from '@/screens/library/PlaylistsCollection'
import { SongsCollection } from '@/screens/library/SongsCollection'
import { FinishedCollection, InProgressCollection } from '@/screens/library/TracksCollection'
import { UnmatchedAlbumsCollection } from '@/screens/library/UnmatchedAlbumsCollection'

/** The page each of Library's categories opens; a TV keeps no downloads, so has no Downloads. */
const COLLECTION_PAGES = {
  [LIBRARY_SEGMENTS.albums]: AlbumsCollection,
  [LIBRARY_SEGMENTS.artists]: ArtistsCollection,
  [LIBRARY_SEGMENTS.playlists]: PlaylistsCollection,
  [LIBRARY_SEGMENTS.unmatchedAlbums]: UnmatchedAlbumsCollection,
  [LIBRARY_SEGMENTS.inProgress]: InProgressCollection,
  [LIBRARY_SEGMENTS.favourites]: FavouritesCollection,
  [LIBRARY_SEGMENTS.finished]: FinishedCollection,
  [LIBRARY_SEGMENTS.songs]: SongsCollection,
} as const satisfies Record<SharedSegment, ComponentType<CollectionPageProps>>

/** The category a Library address names, or Albums for one a TV has not (Downloads) or none. */
const collectionKindOf = orElse<SharedSegment>({
  guard: oneOf(SHARED_ORDER),
  fallback: LIBRARY_SEGMENTS.albums,
})

type CollectionOfProps = { session: WrenSession }

function CollectionOf({ session }: CollectionOfProps) {
  const params = useLocalSearchParams()
  const Page = COLLECTION_PAGES[collectionKindOf(params[WREN_ROUTE_PARAMS.kind])]
  return <Page session={session} />
}

/**
 * `/collection/[kind]`: one of Library's categories on a page of its own, pushed over Library;
 * Back on the remote returns there.
 */
export function Collection() {
  const session = useWren()
  return session !== null && <CollectionOf session={session} />
}
