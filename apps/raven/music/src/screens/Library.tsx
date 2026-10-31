import { MUSIC_SORTS } from '@raven/core'
import { playlistFactsOf } from '@raven/ui/headless'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ComponentType, ReactElement } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'

import { useTileWidth } from '@/components/AlbumGrid'
import { AlbumTile } from '@/components/AlbumTile'
import { ListRow } from '@/components/ListRow'
import { Notice } from '@/components/Notice'
import { Segments } from '@/components/Segments'
import { SongList } from '@/components/SongList'
import { PageTitle, pageStyles, useListContent } from '@/components/TabPage'
import { artistFactsOf } from '@/music/artistFacts'
import { type ListState, byName, byTitle, listStateOf, mergedOf } from '@/music/merged'
import { LIBRARY_COPY, useMusicLibraries } from '@/music/musicLibraries'
import { nextPageOf } from '@/music/nextPage'
import { useCovers } from '@/music/useCovers'
import { LIBRARY_PAGE_COPY } from '@/screens/copy'
import { DownloadsList } from '@/screens/Downloads'
import {
  LIBRARY_SEGMENTS,
  type LibrarySegment,
  WREN_PAGES,
  WREN_ROUTE_PARAMS,
  librarySegmentOf,
  pageHref,
} from '@/routes'
import { SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

/** The Library tab's lists, each named on its tab. */
const SEGMENT_TABS = [
  { key: LIBRARY_SEGMENTS.albums, label: LIBRARY_PAGE_COPY.albums },
  { key: LIBRARY_SEGMENTS.artists, label: LIBRARY_PAGE_COPY.artists },
  { key: LIBRARY_SEGMENTS.songs, label: LIBRARY_PAGE_COPY.songs },
  { key: LIBRARY_SEGMENTS.playlists, label: LIBRARY_PAGE_COPY.playlists },
  { key: LIBRARY_SEGMENTS.downloads, label: LIBRARY_PAGE_COPY.downloads },
] as const

type ListNoticeOfProps = { listing: ListState; empty: string }

/**
 * What a list says in place of its entries: why it could not be read, that it is, that raven
 * holds no music, or that it is empty.
 */
const listNoticeOf = ({ listing: { failure, isRead, hasNoMusic }, empty }: ListNoticeOfProps) => {
  if (failure !== null) return failure.message
  if (!isRead) return LIBRARY_COPY.loading
  return hasNoMusic ? LIBRARY_COPY.noMusic : empty
}

type ListNoticeProps = ListNoticeOfProps

/** A list's notice, standing where its entries would. */
function ListNotice(props: ListNoticeProps) {
  return <Notice text={listNoticeOf(props)} />
}

type SegmentListProps = { session: WrenSession; header: ReactElement }

type AlbumsListProps = SegmentListProps

function AlbumsList({ session, header }: AlbumsListProps) {
  const listContent = useListContent()
  const { columns, tileWidth } = useTileWidth()
  const coverOf = useCovers(session)
  const music = useMusicLibraries(session)
  const listings = useQueries({
    queries: music.libraries.map((library) =>
      session.queries.albumsQuery({ libraryId: library.id, search: '', sort: MUSIC_SORTS.title }),
    ),
  })
  const { entries: albums, ...listing } = mergedOf({ music, listings, order: byTitle })
  return (
    <FlatList
      ListEmptyComponent={<ListNotice empty={LIBRARY_PAGE_COPY.noAlbums} listing={listing} />}
      ListHeaderComponent={header}
      columnWrapperStyle={styles.columns}
      contentContainerStyle={listContent}
      data={albums}
      key={columns}
      keyExtractor={(album) => String(album.id)}
      numColumns={columns}
      renderItem={({ item }) => (
        <AlbumTile
          album={item}
          cover={coverOf({ albumId: item.id, coverVersion: item.coverVersion })}
          width={tileWidth}
        />
      )}
      style={pageStyles.ground}
    />
  )
}

type ArtistsListProps = SegmentListProps

function ArtistsList({ session, header }: ArtistsListProps) {
  const router = useRouter()
  const listContent = useListContent()
  const music = useMusicLibraries(session)
  const listings = useQueries({
    queries: music.libraries.map((library) =>
      session.queries.artistsQuery({ libraryId: library.id, search: '' }),
    ),
  })
  const { entries: artists, ...listing } = mergedOf({ music, listings, order: byName })
  return (
    <FlatList
      ListEmptyComponent={<ListNotice empty={LIBRARY_PAGE_COPY.noArtists} listing={listing} />}
      ListHeaderComponent={header}
      contentContainerStyle={listContent}
      data={artists}
      keyExtractor={(artist) => String(artist.id)}
      renderItem={({ item }) => (
        <ListRow
          line={artistFactsOf({ artist: item })}
          onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: item.id }))}
          title={item.name}
        />
      )}
      style={pageStyles.ground}
    />
  )
}

type SongsListProps = SegmentListProps

function SongsList({ session, header }: SongsListProps) {
  const music = useMusicLibraries(session)
  const songs = useInfiniteQuery(
    session.queries.songsQuery({
      libraryIds: music.libraries.map(({ id }) => id),
      search: '',
      sort: MUSIC_SORTS.title,
    }),
  )
  const tracks = songs.data?.pages.flatMap((page) => page.tracks) ?? []
  return (
    <SongList
      empty={
        <ListNotice
          empty={LIBRARY_PAGE_COPY.noSongs}
          listing={listStateOf({ music, failure: songs.error, isRead: songs.isSuccess })}
        />
      }
      header={header}
      onEnd={nextPageOf(songs)}
      tracks={tracks}
    />
  )
}

type PlaylistsListProps = SegmentListProps

function PlaylistsList({ session, header }: PlaylistsListProps) {
  const router = useRouter()
  const listContent = useListContent()
  const playlists = useQuery(session.queries.playlistsQuery)
  return (
    <FlatList
      ListEmptyComponent={
        <ListNotice
          empty={LIBRARY_PAGE_COPY.noPlaylists}
          listing={{ failure: playlists.error, isRead: playlists.isSuccess, hasNoMusic: false }}
        />
      }
      ListHeaderComponent={header}
      contentContainerStyle={listContent}
      data={playlists.data}
      keyExtractor={(playlist) => String(playlist.id)}
      renderItem={({ item }) => (
        <ListRow
          line={playlistFactsOf({ playlist: item })}
          onPress={() => router.push(pageHref({ page: WREN_PAGES.playlist, id: item.id }))}
          title={item.name}
        />
      )}
      style={pageStyles.ground}
    />
  )
}

type DownloadsSegmentProps = SegmentListProps

/** What is on the device, which plays with the server out of reach. */
function DownloadsSegment({ session, header }: DownloadsSegmentProps) {
  return <DownloadsList header={header} serverId={session.server.id} />
}

/** The list each of the Library tab's segments shows. */
const SEGMENT_LISTS = {
  [LIBRARY_SEGMENTS.albums]: AlbumsList,
  [LIBRARY_SEGMENTS.artists]: ArtistsList,
  [LIBRARY_SEGMENTS.songs]: SongsList,
  [LIBRARY_SEGMENTS.playlists]: PlaylistsList,
  [LIBRARY_SEGMENTS.downloads]: DownloadsSegment,
} as const satisfies Record<LibrarySegment, ComponentType<SegmentListProps>>

type ServerLibraryProps = { session: WrenSession }

function ServerLibrary({ session }: ServerLibraryProps) {
  const router = useRouter()
  const params = useLocalSearchParams()
  // The list rides in the address, so Home's way to the downloads opens on them.
  const segment = librarySegmentOf(params[WREN_ROUTE_PARAMS.segment])
  const header = (
    <View style={pageStyles.header}>
      <PageTitle title={LIBRARY_PAGE_COPY.title} />
      <Segments
        onSelect={(key) => router.setParams({ [WREN_ROUTE_PARAMS.segment]: key })}
        segments={SEGMENT_TABS}
        selected={segment}
      />
    </View>
  )
  const List = SEGMENT_LISTS[segment]
  return <List header={header} session={session} />
}

/**
 * The albums, artists, songs and playlists raven holds, one list at a time: each list holds
 * every music library's, the songs a page at a time. Downloads lists what is on the device.
 */
export function Library() {
  const session = useWren()
  return session !== null && <ServerLibrary session={session} />
}

const styles = StyleSheet.create({
  columns: { gap: SIZES.space3, paddingBottom: SIZES.space3 },
})
