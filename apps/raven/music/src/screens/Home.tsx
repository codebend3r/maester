import type { AlbumSummary, Library } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'

import { useTileWidth } from '@/components/AlbumGrid'
import { AlbumTile } from '@/components/AlbumTile'
import { MaybeNotice, NOTICE_STATES, type NoticeState, noticeStateOf } from '@/components/Notice'
import { TabPage } from '@/components/TabPage'
import { LIBRARY_COPY, useMusicLibraries } from '@/music/musicLibraries'
import { type CoverOf, useCovers } from '@/music/useCovers'
import { HOME_COPY } from '@/screens/copy'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

/** How many of a library's newest albums its shelf holds. */
const RECENT_ALBUMS = 20

type RecentShelfProps = {
  session: WrenSession
  library: Library
  title: string
  coverOf: CoverOf
}

type ShelfViewProps = {
  albums: readonly AlbumSummary[] | undefined
  notice: string | null
  coverOf: CoverOf
}

type ShelfRowProps = ShelfViewProps

/** The shelf's albums in a row that scrolls sideways. */
function ShelfRow({ albums, coverOf }: ShelfRowProps) {
  const { tileWidth } = useTileWidth()
  return (
    <FlatList
      contentContainerStyle={styles.row}
      data={albums}
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
  )
}

/** What a shelf holds: its albums, or why it has none to show. */
const SHELF_VIEWS = {
  [NOTICE_STATES.notice]: MaybeNotice,
  [NOTICE_STATES.ready]: ShelfRow,
} as const satisfies Record<NoticeState, ComponentType<ShelfViewProps>>

/** One music library's newest albums, newest first, in a row that scrolls sideways. */
function RecentShelf({ session, library, title, coverOf }: RecentShelfProps) {
  const albums = useQuery(
    session.queries.recentAlbumsQuery({ libraryId: library.id, limit: RECENT_ALBUMS }),
  )
  const notice = ((): string | null => {
    if (albums.error !== null) return albums.error.message
    if (albums.data === undefined) return LIBRARY_COPY.loading
    return albums.data.length === 0 ? HOME_COPY.noAlbums : null
  })()
  const Shelf = SHELF_VIEWS[noticeStateOf(notice)]
  return (
    <View style={styles.shelf}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      <Shelf albums={albums.data} coverOf={coverOf} notice={notice} />
    </View>
  )
}

type MusicLibraries = ReturnType<typeof useMusicLibraries>

type HomeNoticeOfProps = MusicLibraries

/** What Home says in place of its shelves: why the libraries could not be read, that they are, or that there is no music. */
const homeNoticeOf = ({ libraries, isRead, failure }: HomeNoticeOfProps): string | null => {
  if (failure !== null) return failure.message
  if (!isRead) return LIBRARY_COPY.loading
  return libraries.length === 0 ? LIBRARY_COPY.noMusic : null
}

type HomeViewProps = {
  session: WrenSession
  libraries: readonly Library[]
  notice: string | null
}

type ShelvesProps = HomeViewProps

/** A shelf for each music library. */
function Shelves({ session, libraries }: ShelvesProps) {
  const coverOf = useCovers(session)
  return libraries.map((library) => (
    <RecentShelf
      coverOf={coverOf}
      key={library.id}
      library={library}
      session={session}
      title={libraries.length > 1 ? HOME_COPY.recentIn(library.name) : HOME_COPY.recent}
    />
  ))
}

/** What Home holds: a shelf per music library, or why it has none. */
const HOME_VIEWS = {
  [NOTICE_STATES.notice]: MaybeNotice,
  [NOTICE_STATES.ready]: Shelves,
} as const satisfies Record<NoticeState, ComponentType<HomeViewProps>>

type ServerHomeProps = { session: WrenSession }

function ServerHome({ session }: ServerHomeProps) {
  const music = useMusicLibraries(session)
  const notice = homeNoticeOf(music)
  const HomeView = HOME_VIEWS[noticeStateOf(notice)]
  return <HomeView libraries={music.libraries} notice={notice} session={session} />
}

/** Wren's first tab: what each music library gained lately, to play next. */
export function Home() {
  const session = useWren()
  return (
    <TabPage title={HOME_COPY.title}>
      {session !== null && <ServerHome session={session} />}
    </TabPage>
  )
}

const styles = StyleSheet.create({
  shelf: { gap: SIZES.space2 },
  heading: { color: PALETTE.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
  row: { gap: SIZES.space3 },
})
