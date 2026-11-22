import type { ComponentType } from 'react'
import { useParams } from 'react-router-dom'
import {
  COLLECTION_KINDS,
  type CollectionKind,
  WREN_ROUTE_PARAMS,
  collectionKindOf,
} from '@/routes'
import { AlbumsCollection } from '@/screens/Collection/AlbumsCollection'
import { ArtistsCollection } from '@/screens/Collection/ArtistsCollection'
import { PlaylistsCollection } from '@/screens/Collection/PlaylistsCollection'
import { SongsCollection } from '@/screens/Collection/SongsCollection'
import {
  FavouritesCollection,
  FinishedCollection,
  InProgressCollection,
} from '@/screens/Collection/TracksCollection'
import { UnmatchedAlbumsCollection } from '@/screens/Collection/UnmatchedAlbumsCollection'

/** The page each of Library's categories opens. */
const COLLECTION_PAGES = {
  [COLLECTION_KINDS.albums]: AlbumsCollection,
  [COLLECTION_KINDS.artists]: ArtistsCollection,
  [COLLECTION_KINDS.playlists]: PlaylistsCollection,
  [COLLECTION_KINDS.unmatchedAlbums]: UnmatchedAlbumsCollection,
  [COLLECTION_KINDS.inProgress]: InProgressCollection,
  [COLLECTION_KINDS.favourites]: FavouritesCollection,
  [COLLECTION_KINDS.finished]: FinishedCollection,
  [COLLECTION_KINDS.songs]: SongsCollection,
} as const satisfies Record<CollectionKind, ComponentType>

/**
 * `/collection/:kind`: one of Library's categories on a page of its own, the way back to Library
 * above it.
 */
export function Collection() {
  const kind = collectionKindOf(useParams()[WREN_ROUTE_PARAMS.kind])
  const View = COLLECTION_PAGES[kind]
  return <View />
}
