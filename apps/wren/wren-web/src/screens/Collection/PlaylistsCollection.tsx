import { WREN_ICONS } from '@raven/wren'
import { type PlaylistSummary, plural, playlistFactsOf } from '@raven/core'
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
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { LIST_SHAPES } from '@/components/ListSkeleton/ListSkeleton'
import { usePlaylists } from '@/music/listings'
import { playlistPath } from '@/routes'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { NewPlaylistSheet } from '@/screens/Collection/NewPlaylistSheet'
import { Page } from '@/shell/Page/Page'
import { COLORS } from '@/theme/tokens'
import { AlbumTile } from '@/ui/AlbumTile/AlbumTile'
import { EmptyState } from '@/ui/EmptyState/EmptyState'
import { IconButton } from '@/ui/IconButton/IconButton'
import { TileGrid } from '@/ui/TileGrid/TileGrid'
import styles from '@/screens/Collection/Collection.module.scss'

const NO_PLAYLISTS: readonly PlaylistSummary[] = []

type PlaylistsNoticeProps = { listing: ListState }

function PlaylistsNotice({ listing }: PlaylistsNoticeProps) {
  return (
    <ListNotice empty={LIBRARY_PAGE_COPY.noPlaylists} listing={listing} shape={LIST_SHAPES.tiles} />
  )
}

type NoPlaylistsProps = { onNew: () => void }

function NoPlaylists({ onNew }: NoPlaylistsProps) {
  return (
    <EmptyState
      action={{ label: NEW_PLAYLIST_COPY.title, onPress: onNew }}
      body={LIBRARY_PAGE_COPY.noPlaylistsHint}
      icon={WREN_ICONS.playlist}
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

type PlaylistTileProps = { playlist: PlaylistSummary }

/** A playlist as a tile, as an album is, that opens its page. */
function PlaylistTile({ playlist }: PlaylistTileProps) {
  return (
    <AlbumTile
      cover={null}
      href={playlistPath(playlist.id)}
      label={playlist.name}
      subtitle={playlistFactsOf({ playlist })}
      title={playlist.name}
    />
  )
}

/** Playlists: the account's and the shared ones as tiles, and + to make a new one. */
export function PlaylistsCollection() {
  const playlists = usePlaylists()
  const [isMaking, setIsMaking] = useState(false)
  const onNew = () => setIsMaking(true)
  const empty = EMPTY_VIEW_OF[playlistsStateOf(playlists)]({
    listing: queryListStateOf(playlists),
    onNew,
  })
  const list = playlists.data ?? NO_PLAYLISTS
  return (
    <Page className={styles.grid}>
      <CollectionHeader
        actions={
          <IconButton
            color={COLORS.accentText}
            icon={WREN_ICONS.plus}
            label={NEW_PLAYLIST_COPY.title}
            onPress={onNew}
          />
        }
        count={list.length > 0 ? plural({ n: list.length, ...COUNTS_COPY.playlists }) : null}
        title={LIBRARY_PAGE_COPY.playlists}
      />
      {list.length === 0 && <KeyedView<EmptyViewsProps> view={empty} views={EMPTY_VIEWS} />}
      <TileGrid
        items={list}
        keyOf={(playlist) => playlist.id}
        renderTile={({ item }) => <PlaylistTile playlist={item} />}
      />
      <NewPlaylistSheet isOpen={isMaking} onClose={() => setIsMaking(false)} />
    </Page>
  )
}
