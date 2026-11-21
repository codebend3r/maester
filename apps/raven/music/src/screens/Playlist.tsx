import {
  type PlaylistDetails,
  type PlaylistTrack,
  QUEUE_SOURCE_KINDS,
  playlistTracksOf,
} from '@raven/core'
import { PLAYLIST_COPY, playlistMetaOf, SONG_LEADS } from '@raven/wren'
import { FlatList } from 'react-native'

import { DownloadButton } from '@/components/DownloadButton'
import { TracksMenu } from '@/components/TrackMenu'
import { TrackRow } from '@/components/TrackRow'
import { DOWNLOAD_SOURCES } from '@/downloads/downloadStore'
import { useCovers } from '@/music/useCovers'
import { CollectionHead } from '@/screens/detail/CollectionHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { QueueAction } from '@/screens/detail/QueueAction'
import { IS_ROW_HIGHLIGHTED } from '@/screens/detail/rowHighlight'
import { useTracklist } from '@/screens/detail/useTracklist'
import { useFormFactor } from '@/theme/wrenTheme'
import { EmptyState } from '@/ui/EmptyState'
import { ICONS } from '@/ui/WrenIcon'
import { type WrenSession, useWren } from '@/useWren'

type RenderRowProps = { item: PlaylistTrack }

type PlaylistPageProps = { session: WrenSession; details: PlaylistDetails }

function PlaylistPage({ session, details }: PlaylistPageProps) {
  const formFactor = useFormFactor()
  const { trackCoverOf } = useCovers(session)
  const { playlist, tracks } = details
  const { playingId, play, shuffle, playFrom, queue, isMenuOpen, openMenu, closeMenu } =
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
      lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(item.track) }}
      isCurrent={item.id === playingId}
      isHighlighted={IS_ROW_HIGHLIGHTED[formFactor]}
      label={item.label}
      length={item.length}
      onPress={() => playFrom(item.index)}
      subtitle={item.line}
      track={item.track}
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
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist={false}
          head={{ title: playlist.name, subtitle: playlistMetaOf({ playlist }), cover }}
          onClose={closeMenu}
          places={{}}
          session={session}
          tracksOf={async () => tracks}
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
  const session = useWren()
  return (
    session !== null && (
      <DetailRoute copy={PLAYLIST_COPY} queryOf={session.queries.playlistQuery}>
        {(details) => <PlaylistPage details={details} session={session} />}
      </DetailRoute>
    )
  )
}
