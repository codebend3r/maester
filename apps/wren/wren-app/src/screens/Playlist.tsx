import {
  type PlaylistDetails,
  type PlaylistTrack,
  QUEUE_SOURCE_KINDS,
  playlistTracksOf,
} from '@raven/core'
import { PLAYLIST_COPY, playlistMetaOf, SONG_LEADS, WREN_ICONS } from '@raven/wren'
import { FlatList } from 'react-native'

import { DownloadButton } from '@/components/DownloadButton'
import { TracksMenu } from '@/components/TrackMenu'
import { TrackRow } from '@/components/TrackRow'
import { DOWNLOAD_SOURCES } from '@/downloads/downloadStore'
import { useCovers, type WrenSession } from '@raven/wren-native'
import { CollectionHead } from '@/screens/detail/CollectionHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { QueueAction } from '@/screens/detail/QueueAction'
import { useTracklist } from '@/screens/detail/useTracklist'
import { EmptyState } from '@/ui/EmptyState'

type RenderRowProps = { item: PlaylistTrack }

type PlaylistPageProps = { session: WrenSession; details: PlaylistDetails }

function PlaylistPage({ session, details }: PlaylistPageProps) {
  const { trackCoverOf } = useCovers(session)
  const { playlist, tracks } = details
  const { rowPropsOf, tracksOf, play, shuffle, queue, isMenuOpen, openMenu, closeMenu } =
    useTracklist({
      tracks,
      source: { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id },
      queued: PLAYLIST_COPY.queued(playlist.name),
    })
  const [first] = tracks
  // A playlist has no cover of its own, so it wears its first track's album's.
  const cover = first === undefined ? null : trackCoverOf(first)
  const renderRow = ({ item }: RenderRowProps) => (
    <TrackRow
      {...rowPropsOf(item)}
      lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(item.track) }}
      subtitle={item.line}
    />
  )
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
                  <QueueAction onPress={queue} />
                </>
              )
            }
            canPlay={hasTracks}
            cover={cover}
            meta={playlistMetaOf({ playlist })}
            onMore={openMenu}
            onPlay={play}
            onShuffle={shuffle}
            title={playlist.name}
          />
        }
        renderList={(frame) => (
          <FlatList
            {...frame}
            ListEmptyComponent={
              <EmptyState
                body={PLAYLIST_COPY.empty(playlist.name)}
                icon={WREN_ICONS.playlist}
                title={PLAYLIST_COPY.emptyTitle}
              />
            }
            data={playlistTracksOf({ tracks })}
            keyExtractor={(row) => row.key}
            renderItem={renderRow}
          />
        )}
      />
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist={false}
          head={{ title: playlist.name, subtitle: playlistMetaOf({ playlist }), cover }}
          onClose={closeMenu}
          places={{}}
          session={session}
          tracksOf={tracksOf}
        />
      )}
    </>
  )
}

/**
 * `/playlist/[id]`: one of the listener's playlists, laid out as an album is: its first track's
 * cover, its facts, Play and Shuffle, Download and Queue, and its tracks with their covers.
 */
export function Playlist() {
  return (
    <DetailRoute
      Page={PlaylistPage}
      copy={PLAYLIST_COPY}
      queryOf={(queries) => queries.playlistQuery}
    />
  )
}
