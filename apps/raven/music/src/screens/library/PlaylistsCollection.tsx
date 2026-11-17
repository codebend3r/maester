import { type PlaylistSummary, plural, playlistFactsOf } from '@raven/core'
import { useRouter } from 'expo-router'
import { type ComponentType, useState } from 'react'
import { FlatList } from 'react-native'

import { type ListState, queryListStateOf } from '@/music/merged'
import { LIBRARY_PAGE_COPY } from '@/screens/copy'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { GRID_GAP, useGrid } from '@/ui/TileGrid'
import { usePlaylists } from '@/screens/library/listings'
import { ListNotice } from '@/screens/library/ListNotice'
import { NewPlaylistSheet } from '@/screens/library/NewPlaylistSheet'
import { WREN_PAGES, pageHref } from '@/routes'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { AlbumTile } from '@/ui/AlbumTile'
import { EmptyState } from '@/ui/EmptyState'
import { IconButton } from '@/ui/IconButton'
import { ICONS } from '@/ui/WrenIcon'
import { COUNTS_COPY, NEW_PLAYLIST_COPY } from '@/ui/copy'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s5 },
  columns: { gap: GRID_GAP },
}))

const NO_PLAYLISTS: readonly PlaylistSummary[] = []

/** Whether the list says why it is empty, offers the first playlist, or has some. */
const PLAYLIST_STATES = { notice: 'notice', empty: 'empty' } as const

type PlaylistState = (typeof PLAYLIST_STATES)[keyof typeof PLAYLIST_STATES]

type EmptyPlaylistsProps = {
  listing: ListState
  onNew: () => void
}

function PlaylistsNotice({ listing }: EmptyPlaylistsProps) {
  return <ListNotice empty={LIBRARY_PAGE_COPY.noPlaylists} listing={listing} />
}

function NoPlaylists({ onNew }: EmptyPlaylistsProps) {
  return (
    <EmptyState
      action={{ label: NEW_PLAYLIST_COPY.title, onPress: onNew }}
      body={LIBRARY_PAGE_COPY.noPlaylistsHint}
      icon={ICONS.playlist}
      title={LIBRARY_PAGE_COPY.noPlaylists}
    />
  )
}

const EMPTY_VIEWS = {
  [PLAYLIST_STATES.notice]: PlaylistsNotice,
  [PLAYLIST_STATES.empty]: NoPlaylists,
} as const satisfies Record<PlaylistState, ComponentType<EmptyPlaylistsProps>>

type PlaylistTileProps = { playlist: PlaylistSummary; width: number }

/** A playlist as a tile, as an album is, that opens its page. */
function PlaylistTile({ playlist, width }: PlaylistTileProps) {
  const router = useRouter()
  return (
    <AlbumTile
      cover={null}
      label={playlist.name}
      onPress={() => router.push(pageHref({ page: WREN_PAGES.playlist, id: playlist.id }))}
      subtitle={playlistFactsOf({ playlist })}
      title={playlist.name}
      width={width}
    />
  )
}

/** Playlists: the account's and the shared ones as tiles, and + to make a new one. */
export function PlaylistsCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const insets = usePageInsets()
  const { columns, tileWidth, onLayout } = useGrid()
  const playlists = usePlaylists(session)
  const [isMaking, setIsMaking] = useState(false)
  const listing = queryListStateOf(playlists)
  const Empty = EMPTY_VIEWS[playlists.isSuccess ? PLAYLIST_STATES.empty : PLAYLIST_STATES.notice]
  const list = playlists.data ?? NO_PLAYLISTS
  return (
    <>
      <FlatList
        ListEmptyComponent={<Empty listing={listing} onNew={() => setIsMaking(true)} />}
        ListHeaderComponent={
          <CollectionHeader
            actions={
              <IconButton
                color={colors.accentText}
                icon={ICONS.plus}
                label={NEW_PLAYLIST_COPY.title}
                onPress={() => setIsMaking(true)}
              />
            }
            count={list.length > 0 ? plural({ n: list.length, ...COUNTS_COPY.playlists }) : null}
            onBack={onBack}
            title={LIBRARY_PAGE_COPY.playlists}
          />
        }
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[insets, styles.content]}
        data={list}
        key={columns}
        keyExtractor={(playlist) => String(playlist.id)}
        numColumns={columns}
        onLayout={onLayout}
        renderItem={({ item }) => <PlaylistTile playlist={item} width={tileWidth} />}
        style={styles.ground}
      />
      <NewPlaylistSheet isOpen={isMaking} onClose={() => setIsMaking(false)} session={session} />
    </>
  )
}
