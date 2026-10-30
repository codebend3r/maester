import {
  type PlaylistDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  routeIdOf,
  routeState,
} from '@raven/core'
import { playingTrackOf, useAudioQueue, useServerPlaylistMutations } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { ItemNotice, PlaylistLayout } from '@/layouts'
import { playlistFactsOf, playlistTracksOf } from '@/layouts/musicRows'
import { movedUp, withoutPlace } from '@/music/playlistOrder'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { APP_ROUTE_PARAMS } from '@/routes'

const COPY = {
  opening: 'Opening the playlist',
  missing: 'This playlist is not on the server.',
  failed: (why: string) => `Could not change the playlist: ${why}`,
} as const

type PlaylistPageProps = { session: AppQueries; details: PlaylistDetails }

const PlaylistPage = ({ session: { api }, details }: PlaylistPageProps) => {
  const router = useRouter()
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { rename, setTracks, remove } = useServerPlaylistMutations({ api })
  const { playlist, tracks } = details
  const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id } as const
  const failure = setTracks.failure ?? rename.failure ?? remove.error
  return (
    <PlaylistLayout
      facts={playlistFactsOf({ playlist })}
      name={playlist.name}
      note={failure === null ? null : COPY.failed(failure.message)}
      onBack={() => router.back()}
      onDelete={() => remove.mutate(playlist.id, { onSuccess: () => router.back() })}
      onMoveUp={(index) =>
        setTracks.mutate({ id: playlist.id, tracks: movedUp({ tracks, index }) })
      }
      onPlay={() => playTracks({ tracks, source })}
      onPlayFrom={(startAt) => playTracks({ tracks, startAt, source })}
      onRemove={(index) =>
        setTracks.mutate({ id: playlist.id, tracks: withoutPlace({ tracks, index }) })
      }
      onRename={(name) => rename.mutate({ id: playlist.id, name })}
      onShuffle={() => playTracks({ tracks, source, isShuffled: true })}
      playingId={playingId}
      tracks={playlistTracksOf({ tracks })}
    />
  )
}

type ServerPlaylistProps = { session: AppQueries; id: number | null }

const ServerPlaylist = ({ session, id }: ServerPlaylistProps) => {
  const router = useRouter()
  const playlist = useQuery(session.queries.playlistQuery(id))
  const page = routeState({ id, query: playlist })
  const back = () => router.back()
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <ItemNotice notice={COPY.missing} onBack={back} />
    case ROUTE_STATES.error:
      return <ItemNotice notice={page.message} onBack={back} />
    case ROUTE_STATES.loading:
      return <ItemNotice notice={COPY.opening} onBack={back} />
    case ROUTE_STATES.ready:
      return <PlaylistPage details={page.data} session={session} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/**
 * `/playlist/[id]`: one of the account's playlists, played or shuffled from here, and under the
 * thumb renamed, deleted and its tracks moved up or taken out.
 */
export const Playlist = () => {
  const session = useAppQueries()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  if (session === null) return null
  return <ServerPlaylist key={session.server.id} id={id} session={session} />
}
