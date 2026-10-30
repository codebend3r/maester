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
import { PageTitle, pageStyles, usePageTop } from '@/components/TabPage'
import { byName, byTitle, mergedOf } from '@/music/merged'
import { LIBRARY_COPY, useMusicLibraries } from '@/music/musicLibraries'
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

type ListNoticeProps = { failure: Error | null; isRead: boolean; empty: string }

/** What a list says in place of its entries: why it could not be read, that it is, or that it is empty. */
function ListNotice({ failure, isRead, empty }: ListNoticeProps) {
  if (failure !== null) return <Notice text={failure.message} />
  return <Notice text={isRead ? empty : LIBRARY_COPY.loading} />
}

type SegmentListProps = { session: WrenSession; header: ReactElement }

function AlbumsList({ session, header }: SegmentListProps) {
  const top = usePageTop()
  const { columns, tileWidth } = useTileWidth()
  const coverOf = useCovers(session)
  const music = useMusicLibraries(session)
  const listings = useQueries({
    queries: music.libraries.map((library) =>
      session.queries.albumsQuery({ libraryId: library.id, search: '', sort: MUSIC_SORTS.title }),
    ),
  })
  const { entries, failure, isRead } = mergedOf({ listings })
  const albums = music.libraries.length > 1 ? byTitle(entries) : entries
  return (
    <FlatList
      ListEmptyComponent={
        <ListNotice
          empty={music.libraries.length === 0 ? LIBRARY_COPY.noMusic : COPY.noAlbums}
          failure={music.failure ?? failure}
          isRead={music.isRead && isRead}
        />
      }
      ListHeaderComponent={header}
      columnWrapperStyle={styles.columns}
      contentContainerStyle={[pageStyles.content, { paddingTop: top }]}
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
  const top = usePageTop()
  const music = useMusicLibraries(session)
  const listings = useQueries({
    queries: music.libraries.map((library) =>
      session.queries.artistsQuery({ libraryId: library.id, search: '' }),
    ),
  })
  const { entries, failure, isRead } = mergedOf({ listings })
  const artists = music.libraries.length > 1 ? byName(entries) : entries
  return (
    <FlatList
      ListEmptyComponent={
        <ListNotice
          empty={music.libraries.length === 0 ? LIBRARY_COPY.noMusic : COPY.noArtists}
          failure={music.failure ?? failure}
          isRead={music.isRead && isRead}
        />
      }
      ListHeaderComponent={header}
      contentContainerStyle={[pageStyles.content, { paddingTop: top }]}
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
  const onEnd = () => {
    if (!songs.hasNextPage || songs.isFetchingNextPage) return
    // A page that fails keeps its error on the query, which the list says.
    songs.fetchNextPage().catch(() => undefined)
  }
  return (
    <SongList
      empty={
        <ListNotice
          empty={music.libraries.length === 0 ? LIBRARY_COPY.noMusic : COPY.noSongs}
          failure={music.failure ?? songs.error}
          isRead={music.isRead && (music.libraries.length === 0 || songs.isSuccess)}
        />
      }
      header={header}
      onEnd={onEnd}
      tracks={tracks}
    />
  )
}

function PlaylistsList({ session, header }: SegmentListProps) {
  const router = useRouter()
  const top = usePageTop()
  const playlists = useQuery(session.queries.playlistsQuery)
  return (
    <FlatList
      ListEmptyComponent={
        <ListNotice
          empty={COPY.noPlaylists}
          failure={playlists.error}
          isRead={playlists.isSuccess}
        />
      }
      ListHeaderComponent={header}
      contentContainerStyle={[pageStyles.content, { paddingTop: top }]}
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
    <View style={styles.header}>
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
  header: { gap: SIZES.space4 },
  columns: { gap: SIZES.space3 },
})
