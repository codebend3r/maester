import {
  type PlaylistDetails,
  type PlaylistTrack,
  QUEUE_SOURCE_KINDS,
  playlistTracksOf,
} from '@raven/core'
import { PLAYLIST_COPY, SONG_LEADS, playlistMetaOf, WREN_ICONS } from '@raven/wren'
import { TracksMenu } from '@/components/TrackMenu/TrackMenu'
import { queries } from '@/lib/queries'
import { useCovers } from '@/music/useCovers'
import { CollectionHead } from '@/screens/detail/CollectionHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { DetailTrackRow } from '@/screens/detail/DetailTrackRow'
import { DetailTracks } from '@/screens/detail/DetailTracks'
import { QueueAction } from '@/screens/detail/QueueAction'
import { useTracklist } from '@/screens/detail/useTracklist'
import { EmptyState } from '@/ui/EmptyState/EmptyState'

type PlaylistPageProps = { details: PlaylistDetails }

function PlaylistPage({ details }: PlaylistPageProps) {
  const { trackCoverOf } = useCovers()
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
  const renderRow = (item: PlaylistTrack) => (
    <DetailTrackRow
      isCurrent={item.id === playingId}
      key={item.key}
      label={item.label}
      lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(item.track) }}
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
            actions={hasTracks && <QueueAction onPress={queue} />}
            canPlay={hasTracks}
            cover={cover}
            meta={playlistMetaOf({ playlist })}
            onMore={openMenu}
            onPlay={play}
            onShuffle={shuffle}
            title={playlist.name}
          />
        }
      >
        {!hasTracks && (
          <EmptyState
            body={PLAYLIST_COPY.empty(playlist.name)}
            icon={WREN_ICONS.playlist}
            title={PLAYLIST_COPY.emptyTitle}
          />
        )}
        {hasTracks && <DetailTracks>{playlistTracksOf({ tracks }).map(renderRow)}</DetailTracks>}
      </DetailSplit>
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist={false}
          head={{ title: playlist.name, subtitle: playlistMetaOf({ playlist }), cover }}
          onClose={closeMenu}
          places={{}}
          tracksOf={async () => tracks}
        />
      )}
    </>
  )
}

/**
 * `/playlist/:id`: one of the listener's playlists, laid out as an album is: its first track's
 * cover, its facts, Play and Shuffle, Queue, and its tracks with their covers.
 */
export function Playlist() {
  return (
    <DetailRoute copy={PLAYLIST_COPY} queryOf={queries.playlistQuery}>
      {(details) => <PlaylistPage details={details} />}
    </DetailRoute>
  )
}
