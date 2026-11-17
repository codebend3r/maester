import {
  type PlaylistDetails,
  type PlaylistTrack,
  QUEUE_SOURCE_KINDS,
  playlistTracksOf,
  routeIdOf,
} from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { FlatList } from 'react-native'

import { DetailAction } from '@/components/DetailAction'
import { DownloadButton } from '@/components/DownloadButton'
import { MENU_VIEWS, type MenuView, TracksMenu } from '@/components/TrackMenu'
import { TrackRow } from '@/components/TrackRow'
import { DOWNLOAD_SOURCES } from '@/downloads/downloadStore'
import { useCovers } from '@/music/useCovers'
import { WREN_ROUTE_PARAMS } from '@/routes'
import { PLAYLIST_COPY } from '@/screens/copy'
import { CollectionHead } from '@/screens/detail/CollectionHead'
import { playlistMetaOf } from '@/screens/detail/detailFacts'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { useToast } from '@/stores/toast'
import { useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { PLAYER_COPY } from '@/ui/copy'
import { EmptyState } from '@/ui/EmptyState'
import { SONG_LEADS } from '@/ui/songLead'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'
import { type WrenSession, useWren } from '@/useWren'

// A tablet's tracklist marks the playing row with a soft fill as well as the equalizer.
const IS_ROW_HIGHLIGHTED = {
  [FORM_FACTORS.phone]: false,
  [FORM_FACTORS.tablet]: true,
} as const satisfies Record<FormFactor, boolean>

type RenderRowProps = { item: PlaylistTrack }

type PlaylistPageProps = { session: WrenSession; details: PlaylistDetails }

function PlaylistPage({ session, details }: PlaylistPageProps) {
  const { colors } = useWrenTheme()
  const formFactor = useFormFactor()
  const { trackCoverOf } = useCovers(session)
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const toast = useToast((state) => state.show)
  const [menu, setMenu] = useState<MenuView | null>(null)
  const { playlist, tracks } = details
  const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id } as const
  const [first] = tracks
  // A playlist has no cover of its own, so it wears its first track's album's.
  const cover = first === undefined ? null : trackCoverOf(first)
  const queuePlaylist = () => {
    addToQueue(tracks)
    toast(PLAYLIST_COPY.queued(playlist.name))
  }
  const renderRow = ({ item }: RenderRowProps) => {
    const track = tracks[item.index]
    return (
      track !== undefined && (
        <TrackRow
          lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(track) }}
          isCurrent={item.id === playingId}
          isHighlighted={IS_ROW_HIGHLIGHTED[formFactor]}
          label={item.label}
          length={item.length}
          onPress={() => playTracks({ tracks, startAt: item.index, source })}
          subtitle={item.line}
          track={track}
        />
      )
    )
  }
  const hasTracks = tracks.length > 0
  return (
    <>
      <DetailSplit
        head={
          <CollectionHead
            actions={
              hasTracks && (
                <>
                  <DownloadButton
                    collection={{ kind: DOWNLOAD_SOURCES.playlist, playlist }}
                    cover={cover}
                    serverId={session.server.id}
                    title={playlist.name}
                    tracks={tracks}
                  />
                  <DetailAction
                    glyph={<WrenIcon color={colors.text2} name={ICONS.queueAdd} />}
                    label={PLAYER_COPY.queue}
                    onPress={queuePlaylist}
                  />
                </>
              )
            }
            canPlay={hasTracks}
            cover={cover}
            meta={playlistMetaOf({ playlist })}
            onMore={() => setMenu(MENU_VIEWS.actions)}
            onPlay={() => playTracks({ tracks, source })}
            onShuffle={() => playTracks({ tracks, source, isShuffled: true })}
            title={playlist.name}
          />
        }
        renderList={(frame) => (
          <FlatList
            {...frame}
            ListEmptyComponent={
              <EmptyState
                body={PLAYLIST_COPY.empty(playlist.name)}
                icon={ICONS.playlist}
                title={PLAYLIST_COPY.emptyTitle}
              />
            }
            data={playlistTracksOf({ tracks })}
            keyExtractor={(row) => row.key}
            renderItem={renderRow}
          />
        )}
      />
      {menu !== null && (
        <TracksMenu
          canAddToPlaylist={false}
          head={{ title: playlist.name, subtitle: playlistMetaOf({ playlist }), cover }}
          onView={setMenu}
          session={session}
          tracksOf={async () => tracks}
          view={menu}
        />
      )}
    </>
  )
}

type ServerPlaylistProps = { session: WrenSession; id: number | null }

function ServerPlaylist({ session, id }: ServerPlaylistProps) {
  const playlist = useQuery(session.queries.playlistQuery(id))
  return (
    <DetailRoute copy={PLAYLIST_COPY} id={id} query={playlist}>
      {(details) => <PlaylistPage details={details} session={session} />}
    </DetailRoute>
  )
}

/**
 * `/playlist/[id]`: one of the listener's playlists, laid out as an album is: its first track's
 * cover, its facts, Play and Shuffle, Download and Queue, and its tracks with their covers.
 */
export function Playlist() {
  const session = useWren()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[WREN_ROUTE_PARAMS.id])
  return session !== null && <ServerPlaylist id={id} session={session} />
}
