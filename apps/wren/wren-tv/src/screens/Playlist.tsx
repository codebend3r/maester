import {
  type PlaylistDetails,
  type PlaylistTrack,
  QUEUE_SOURCE_KINDS,
  playlistTracksOf,
} from '@raven/core'
import { PLAYLIST_COPY, SONG_LEADS, playlistMetaOf, WREN_ICONS } from '@raven/wren'
import { FlatList } from 'react-native'

import { TrackRow } from '@/components/TrackRow'
import { useCovers, type WrenSession } from '@raven/wren-native'
import { DetailHead } from '@/screens/detail/DetailHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { QueueButton } from '@/screens/detail/QueueButton'
import { useTracklistRows } from '@/screens/detail/useTracklistRows'
import { EmptyState } from '@/ui/EmptyState'
import { ListFrame } from '@/ui/ListFrame'

type RenderRowProps = { item: PlaylistTrack }

type PlaylistPageProps = { session: WrenSession; details: PlaylistDetails }

function PlaylistPage({ session, details }: PlaylistPageProps) {
  const { trackCoverOf } = useCovers(session)
  const { playlist, tracks } = details
  const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id } as const
  const tracksOf = async () => tracks
  const rowPropsOf = useTracklistRows({ tracks, source })
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
  const meta = playlistMetaOf({ playlist })
  return (
    <DetailSplit
      head={
        <DetailHead
          actions={
            hasTracks && (
              <QueueButton queued={PLAYLIST_COPY.queued(playlist.name)} tracksOf={tracksOf} />
            )
          }
          canPlay={hasTracks}
          cover={cover}
          menu={{ canAddToPlaylist: false, line: meta, places: {} }}
          meta={meta}
          session={session}
          source={source}
          title={playlist.name}
          tracksOf={tracksOf}
        />
      }
      list={
        <ListFrame>
          {(fill) => (
            <FlatList
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
              style={fill}
            />
          )}
        </ListFrame>
      }
    />
  )
}

/**
 * `/playlist/[id]`: one of the listener's playlists, laid out as an album is: its first track's
 * cover, its facts, Play and Shuffle, Queue and More, and its tracks with their covers.
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
