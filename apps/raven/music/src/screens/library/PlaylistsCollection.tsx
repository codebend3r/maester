import { type PlaylistSummary, plural, playlistFactsOf } from '@raven/core'
import { useRouter } from 'expo-router'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import {
  COUNTS_COPY,
  LIBRARY_PAGE_COPY,
  type ListState,
  NEW_PLAYLIST_COPY,
  PLAYLIST_STATES,
  type PlaylistState,
  playlistsStateOf,
  queryListStateOf,
} from '@raven/wren'
import { useState } from 'react'
import { FlatList } from 'react-native'

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

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s5 },
  columns: { gap: GRID_GAP },
}))

const NO_PLAYLISTS: readonly PlaylistSummary[] = []

type PlaylistsNoticeProps = { listing: ListState }

function PlaylistsNotice({ listing }: PlaylistsNoticeProps) {
  return <ListNotice empty={LIBRARY_PAGE_COPY.noPlaylists} listing={listing} />
}

type NoPlaylistsProps = { onNew: () => void }

function NoPlaylists({ onNew }: NoPlaylistsProps) {
  return (
    <EmptyState
      action={{ label: NEW_PLAYLIST_COPY.title, onPress: onNew }}
      body={LIBRARY_PAGE_COPY.noPlaylistsHint}
      icon={ICONS.playlist}
      title={LIBRARY_PAGE_COPY.noPlaylists}
    />
  )
}

type EmptyViewsProps = {
  [PLAYLIST_STATES.notice]: PlaylistsNoticeProps
  [PLAYLIST_STATES.empty]: NoPlaylistsProps
}

const EMPTY_VIEWS = {
  [PLAYLIST_STATES.notice]: PlaylistsNotice,
  [PLAYLIST_STATES.empty]: NoPlaylists,
} as const satisfies ViewsOf<EmptyViewsProps>

type EmptyViewOfProps = PlaylistsNoticeProps & NoPlaylistsProps

/** What each state of an empty list draws, handed only what it reads. */
const EMPTY_VIEW_OF = {
  [PLAYLIST_STATES.notice]: ({ listing }) => ({ key: PLAYLIST_STATES.notice, props: { listing } }),
  [PLAYLIST_STATES.empty]: ({ onNew }) => ({ key: PLAYLIST_STATES.empty, props: { onNew } }),
} as const satisfies Record<PlaylistState, (props: EmptyViewOfProps) => ViewOf<EmptyViewsProps>>

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
  const onNew = () => setIsMaking(true)
  const empty = EMPTY_VIEW_OF[playlistsStateOf(playlists)]({
    listing: queryListStateOf(playlists),
    onNew,
  })
  const list = playlists.data ?? NO_PLAYLISTS
  return (
    <>
      <FlatList
        ListEmptyComponent={<KeyedView<EmptyViewsProps> view={empty} views={EMPTY_VIEWS} />}
        ListHeaderComponent={
          <CollectionHeader
            actions={
              <IconButton
                color={colors.accentText}
                icon={ICONS.plus}
                label={NEW_PLAYLIST_COPY.title}
                onPress={onNew}
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
