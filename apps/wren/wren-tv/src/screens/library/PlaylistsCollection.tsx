import { WREN_ICONS } from '@raven/wren'
import { type PlaylistSummary, playlistFactsOf, plural } from '@raven/core'
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
import { router } from 'expo-router'
import { type ComponentType, useState } from 'react'

import { ListNotice } from '@/components/ListNotice'
import { useToast, usePlaylists } from '@raven/wren-native'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { CollectionGrid } from '@/screens/library/CollectionGrid'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { SIZE } from '@/theme/tvTokens'
import { EmptyState } from '@/ui/EmptyState'
import { FocusButton } from '@/ui/FocusButton'
import { NewPlaylistForm } from '@/ui/NewPlaylistForm'
import { Sheet } from '@/ui/Sheet'
import { Tile } from '@/ui/Tile'

const NO_PLAYLISTS: readonly PlaylistSummary[] = []

type PlaylistsNoticeProps = { listing: ListState }

function PlaylistsNotice({ listing }: PlaylistsNoticeProps) {
  return <ListNotice empty={LIBRARY_PAGE_COPY.noPlaylists} listing={listing} />
}

type NoPlaylistsProps = { onNew: () => void }

function NoPlaylists({ onNew }: NoPlaylistsProps) {
  return (
    <EmptyState
      action={{ text: NEW_PLAYLIST_COPY.title, onPress: onNew }}
      body={LIBRARY_PAGE_COPY.noPlaylistsHint}
      icon={WREN_ICONS.playlist}
      title={LIBRARY_PAGE_COPY.noPlaylists}
    />
  )
}

/** What either view of an empty list is handed; each reads only its part. */
type EmptyViewProps = { listing: ListState; onNew: () => void }

/** What an empty list draws in each state: why it holds nothing, or the way to make the first. */
const EMPTY_VIEWS = {
  [PLAYLIST_STATES.notice]: PlaylistsNotice,
  [PLAYLIST_STATES.empty]: NoPlaylists,
} as const satisfies Record<PlaylistState, ComponentType<EmptyViewProps>>

type PlaylistTileProps = { playlist: PlaylistSummary }

/** A playlist as a tile, as an album is, that opens its page. */
function PlaylistTile({ playlist }: PlaylistTileProps) {
  return (
    <Tile
      cover={null}
      line={playlistFactsOf({ playlist })}
      onPress={() => router.push(pageHref({ page: WREN_PAGES.playlist, id: playlist.id }))}
      label={playlist.name}
      title={playlist.name}
      width={SIZE.tile}
    />
  )
}

/** Playlists: the account's and the shared ones as tiles, and New playlist to make one. */
export function PlaylistsCollection({ session }: CollectionPageProps) {
  const playlists = usePlaylists(session)
  const [isMaking, setIsMaking] = useState(false)
  const onNew = () => setIsMaking(true)
  const Empty = EMPTY_VIEWS[playlistsStateOf(playlists)]
  const list = playlists.data ?? NO_PLAYLISTS
  return (
    <>
      <CollectionGrid
        empty={<Empty listing={queryListStateOf(playlists)} onNew={onNew} />}
        header={
          <CollectionHeader
            count={list.length > 0 ? plural({ n: list.length, ...COUNTS_COPY.playlists }) : null}
            title={LIBRARY_PAGE_COPY.playlists}
          >
            <FocusButton
              hasPreferredFocus
              icon={WREN_ICONS.plus}
              label={NEW_PLAYLIST_COPY.title}
              onPress={onNew}
              text={NEW_PLAYLIST_COPY.title}
            />
          </CollectionHeader>
        }
        items={list}
        keyOf={(playlist) => playlist.id}
        renderTile={(playlist) => <PlaylistTile playlist={playlist} />}
        tile={SIZE.tile}
      />
      <Sheet isOpen={isMaking} onClose={() => setIsMaking(false)} title={NEW_PLAYLIST_COPY.title}>
        <NewPlaylistForm
          onCreated={(playlist) => {
            useToast.getState().show(LIBRARY_PAGE_COPY.created(playlist.name))
            setIsMaking(false)
            router.push(pageHref({ page: WREN_PAGES.playlist, id: playlist.id }))
          }}
          session={session}
        />
      </Sheet>
    </>
  )
}
