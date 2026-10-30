import type { Library } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { FlatList, StyleSheet, Text, View } from 'react-native'

import { useTileWidth } from '@/components/AlbumGrid'
import { AlbumTile } from '@/components/AlbumTile'
import { Notice } from '@/components/Notice'
import { TabPage } from '@/components/TabPage'
import { LIBRARY_COPY, useMusicLibraries } from '@/music/musicLibraries'
import { type CoverOf, useCovers } from '@/music/useCovers'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

/** How many of a library's newest albums its shelf holds. */
const RECENT_ALBUMS = 20

const COPY = {
  title: 'Home',
  recent: 'Recently added',
  recentIn: (library: string) => `Recently added to ${library}`,
  noAlbums: 'No albums yet.',
} as const

type RecentShelfProps = {
  session: WrenSession
  library: Library
  title: string
  coverOf: CoverOf
}

/** One music library's newest albums, newest first, in a row that scrolls sideways. */
function RecentShelf({ session, library, title, coverOf }: RecentShelfProps) {
  const albums = useQuery(
    session.queries.recentAlbumsQuery({ libraryId: library.id, limit: RECENT_ALBUMS }),
  )
  const { tileWidth } = useTileWidth()
  const notice = ((): string | null => {
    if (albums.error !== null) return albums.error.message
    if (albums.data === undefined) return LIBRARY_COPY.loading
    return albums.data.length === 0 ? COPY.noAlbums : null
  })()
  return (
    <View style={styles.shelf}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {notice === null ? (
        <FlatList
          contentContainerStyle={styles.row}
          data={albums.data}
          horizontal
          keyExtractor={(album) => String(album.id)}
          renderItem={({ item }) => (
            <AlbumTile
              album={item}
              cover={coverOf({ albumId: item.id, coverVersion: item.coverVersion })}
              width={tileWidth}
            />
          )}
          showsHorizontalScrollIndicator={false}
        />
      ) : (
        <Notice text={notice} />
      )}
    </View>
  )
}

type ServerHomeProps = { session: WrenSession }

function ServerHome({ session }: ServerHomeProps) {
  const { libraries, isRead, failure } = useMusicLibraries(session)
  const coverOf = useCovers(session)
  if (failure !== null) return <Notice text={failure.message} />
  if (!isRead) return <Notice text={LIBRARY_COPY.loading} />
  if (libraries.length === 0) return <Notice text={LIBRARY_COPY.noMusic} />
  return libraries.map((library) => (
    <RecentShelf
      coverOf={coverOf}
      key={library.id}
      library={library}
      session={session}
      title={libraries.length > 1 ? COPY.recentIn(library.name) : COPY.recent}
    />
  ))
}

/** Wren's first tab: what each music library gained lately, to play next. */
export function Home() {
  const session = useWren()
  return (
    <TabPage title={COPY.title}>{session !== null && <ServerHome session={session} />}</TabPage>
  )
}

const styles = StyleSheet.create({
  shelf: { gap: SIZES.space2 },
  heading: { color: PALETTE.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
  row: { gap: SIZES.space3 },
})
