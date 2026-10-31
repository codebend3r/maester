import { MUSIC_SORTS, plural } from '@raven/core'
import { playlistFactsOf } from '@raven/ui/headless'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { type ReactElement, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'

import { useTileWidth } from '@/components/AlbumGrid'
import { AlbumTile } from '@/components/AlbumTile'
import { ListRow } from '@/components/ListRow'
import { Notice } from '@/components/Notice'
import { Segments } from '@/components/Segments'
import { SongList } from '@/components/SongList'
import { PageTitle, pageStyles, useListContent } from '@/components/TabPage'
import { type ListState, byName, byTitle, listStateOf, mergedOf } from '@/music/merged'
import { LIBRARY_COPY, useMusicLibraries } from '@/music/musicLibraries'
import { nextPageOf } from '@/music/nextPage'
import { useCovers } from '@/music/useCovers'
import { WREN_PAGES, pageHref } from '@/routes'
import { SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

/** The lists the Library tab shows, one at a time. */
const SEGMENTS = {
  albums: 'albums',
  artists: 'artists',
  songs: 'songs',
  playlists: 'playlists',
} as const

type Segment = (typeof SEGMENTS)[keyof typeof SEGMENTS]

const COPY = {
  title: 'Library',
  segments: [
    { key: SEGMENTS.albums, label: 'Albums' },
    { key: SEGMENTS.artists, label: 'Artists' },
    { key: SEGMENTS.songs, label: 'Songs' },
    { key: SEGMENTS.playlists, label: 'Playlists' },
  ],
  noAlbums: 'No albums yet.',
  noArtists: 'No artists yet.',
  noSongs: 'No songs yet.',
  noPlaylists: 'No playlists yet. Add a track to one from its menu.',
} as const

type ListNoticeProps = { listing: ListState; empty: string }

/**
 * What a list says in place of its entries: why it could not be read, that it is, that raven
 * holds no music, or that it is empty.
 */
function ListNotice({ listing: { failure, isRead, hasNoMusic }, empty }: ListNoticeProps) {
  if (failure !== null) return <Notice text={failure.message} />
  if (!isRead) return <Notice text={LIBRARY_COPY.loading} />
  return <Notice text={hasNoMusic ? LIBRARY_COPY.noMusic : empty} />
}

type SegmentListProps = { session: WrenSession; header: ReactElement }

function AlbumsList({ session, header }: SegmentListProps) {
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
      ListEmptyComponent={<ListNotice empty={COPY.noAlbums} listing={listing} />}
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

function ArtistsList({ session, header }: SegmentListProps) {
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
      ListEmptyComponent={<ListNotice empty={COPY.noArtists} listing={listing} />}
      ListHeaderComponent={header}
      contentContainerStyle={listContent}
      data={artists}
      keyExtractor={(artist) => String(artist.id)}
      renderItem={({ item }) => (
        <ListRow
          line={[
            plural({ n: item.albumCount, one: 'album', many: 'albums' }),
            plural({ n: item.trackCount, one: 'track', many: 'tracks' }),
          ].join(' · ')}
          onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: item.id }))}
          title={item.name}
        />
      )}
      style={pageStyles.ground}
    />
  )
}

function SongsList({ session, header }: SegmentListProps) {
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
          empty={COPY.noSongs}
          listing={listStateOf({ music, failure: songs.error, isRead: songs.isSuccess })}
        />
      }
      header={header}
      onEnd={nextPageOf(songs)}
      tracks={tracks}
    />
  )
}

function PlaylistsList({ session, header }: SegmentListProps) {
  const router = useRouter()
  const listContent = useListContent()
  const playlists = useQuery(session.queries.playlistsQuery)
  return (
    <FlatList
      ListEmptyComponent={
        <ListNotice
          empty={COPY.noPlaylists}
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

type ServerLibraryProps = { session: WrenSession }

function ServerLibrary({ session }: ServerLibraryProps) {
  const [segment, setSegment] = useState<Segment>(SEGMENTS.albums)
  const header = (
    <View style={pageStyles.header}>
      <PageTitle title={COPY.title} />
      <Segments onSelect={setSegment} segments={COPY.segments} selected={segment} />
    </View>
  )
  switch (segment) {
    case SEGMENTS.albums:
      return <AlbumsList header={header} session={session} />
    case SEGMENTS.artists:
      return <ArtistsList header={header} session={session} />
    case SEGMENTS.songs:
      return <SongsList header={header} session={session} />
    case SEGMENTS.playlists:
      return <PlaylistsList header={header} session={session} />
    default: {
      const unknown: never = segment
      return unknown
    }
  }
}

/**
 * The albums, artists, songs and playlists raven holds, one list at a time: each list holds
 * every music library's, the songs a page at a time.
 */
export function Library() {
  const session = useWren()
  return session !== null && <ServerLibrary session={session} />
}

const styles = StyleSheet.create({
  columns: { gap: SIZES.space3, paddingBottom: SIZES.space3 },
})
