import { oneOf, orElse } from '@raven/core'
import { LIBRARY_SEGMENTS, type LibrarySegment } from '@raven/wren'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ComponentType } from 'react'

import { DownloadsList } from '@/screens/Downloads'
import { AlbumsCollection } from '@/screens/library/AlbumsCollection'
import { ArtistsCollection } from '@/screens/library/ArtistsCollection'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { PlaylistsCollection } from '@/screens/library/PlaylistsCollection'
import { SongsCollection } from '@/screens/library/SongsCollection'
import {
  FavouritesCollection,
  FinishedCollection,
  InProgressCollection,
} from '@/screens/library/TracksCollection'
import { UnmatchedAlbumsCollection } from '@/screens/library/UnmatchedAlbumsCollection'
import { WREN_ROUTES, WREN_ROUTE_PARAMS } from '@/routes'
import { type WrenSession, useWren } from '@/useWren'

/** What is downloaded from this server, which plays with it out of reach. */
function DownloadsCollection({ session, onBack }: CollectionPageProps) {
  return <DownloadsList onBack={onBack} serverId={session.server.id} />
}

/** The page each of Library's categories opens. */
const COLLECTION_PAGES = {
  [LIBRARY_SEGMENTS.albums]: AlbumsCollection,
  [LIBRARY_SEGMENTS.artists]: ArtistsCollection,
  [LIBRARY_SEGMENTS.playlists]: PlaylistsCollection,
  [LIBRARY_SEGMENTS.unmatchedAlbums]: UnmatchedAlbumsCollection,
  [LIBRARY_SEGMENTS.inProgress]: InProgressCollection,
  [LIBRARY_SEGMENTS.favourites]: FavouritesCollection,
  [LIBRARY_SEGMENTS.finished]: FinishedCollection,
  [LIBRARY_SEGMENTS.songs]: SongsCollection,
  [LIBRARY_SEGMENTS.downloads]: DownloadsCollection,
} as const satisfies Record<LibrarySegment, ComponentType<CollectionPageProps>>

/** The segment a Library address names, or Albums when it names none it knows. */
const librarySegmentOf = orElse<LibrarySegment>({
  guard: oneOf(Object.values(LIBRARY_SEGMENTS)),
  fallback: LIBRARY_SEGMENTS.albums,
})

type CollectionOfProps = { session: WrenSession }

function CollectionOf({ session }: CollectionOfProps) {
  const router = useRouter()
  const params = useLocalSearchParams()
  const kind = librarySegmentOf(params[WREN_ROUTE_PARAMS.kind])
  const onBack = () => {
    // Opened from the tablet's sidebar or a link, there may be no page behind it.
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.navigate(WREN_ROUTES.library)
  }
  const Page = COLLECTION_PAGES[kind]
  return <Page onBack={onBack} session={session} />
}

/** `/collection/[kind]`: one of Library's categories on a page of its own, the way back to Library above it. */
export function Collection() {
  const session = useWren()
  return session !== null && <CollectionOf session={session} />
}
