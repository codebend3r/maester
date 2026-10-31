import {
  type AlbumDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  type RouteQuery,
  routeIdOf,
  routeState,
} from '@raven/core'
import {
  albumDiscsOf,
  albumFactsOf,
  playingTrackOf,
  useAudioQueue,
  useServerAlbumFavourite,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ComponentType } from 'react'

import { AlbumLayout } from '@/layouts'
import { usePlaylistAdd } from '@/music/usePlaylistAdd'
import { pictureAt } from '@/queries/cards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'
import { ALBUM_COPY } from '@/screens/copy'
import { RouteError, RouteLoading, RouteMissing, type RouteViewProps } from '@/screens/RouteNotices'

type AlbumPageProps = { session: AppQueries; details: AlbumDetails }

const AlbumPage = ({ session, details }: AlbumPageProps) => {
  const { server, api } = session
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const playNext = useAudioQueue((store) => store.playNext)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const { album, tracks, discCount, isFavourite } = details
  const favourite = useServerAlbumFavourite({ api, albumId: album.id })
  const { playlists, addToPlaylist, note } = usePlaylistAdd({ session })
  const cover =
    pictures === null
      ? null
      : pictureAt({
          uri: api.albumCoverUrl({ albumId: album.id, coverVersion: album.coverVersion }),
          headersFor: pictures.headersFor,
        })
  const source = { kind: QUEUE_SOURCE_KINDS.album, id: album.id } as const
  return (
    <AlbumLayout
      artists={album.artists}
      cover={cover}
      discs={albumDiscsOf({ tracks, discCount })}
      facts={albumFactsOf({ album })}
      isFavourite={isFavourite}
      note={note ?? favourite.failure?.message ?? null}
      onAddToPlaylist={({ pick, index }) =>
        addToPlaylist({
          pick,
          tracks: index === null ? tracks : tracks.filter((_track, place) => place === index),
        })
      }
      onAddToQueue={() => addToQueue(tracks)}
      onFavourite={() => favourite.mutate(!isFavourite)}
      onBack={() => router.back()}
      onOpenArtist={(artistId) => router.push(hrefOf({ kind: ROUTE_TARGETS.artist, artistId }))}
      onPlay={() => playTracks({ tracks, source })}
      onPlayFrom={(startAt) => playTracks({ tracks, startAt, source })}
      onPlayNext={() => playNext(tracks)}
      onShuffle={() => playTracks({ tracks, source, isShuffled: true })}
      playingId={playingId}
      playlists={playlists}
      title={album.title}
    />
  )
}

type ServerAlbumViewProps = RouteViewProps<AlbumDetails> & { session: AppQueries }

type AlbumReadyProps = ServerAlbumViewProps

const AlbumReady = ({ page, session }: AlbumReadyProps) =>
  page.state === ROUTE_STATES.ready && <AlbumPage details={page.data} session={session} />

/** What the page draws in each state its read is in. */
const SERVER_ALBUM_VIEWS = {
  [ROUTE_STATES.missing]: RouteMissing,
  [ROUTE_STATES.error]: RouteError,
  [ROUTE_STATES.loading]: RouteLoading,
  [ROUTE_STATES.ready]: AlbumReady,
} as const satisfies Record<RouteQuery<AlbumDetails>['state'], ComponentType<ServerAlbumViewProps>>

type ServerAlbumProps = { session: AppQueries; id: number | null }

const ServerAlbum = ({ session, id }: ServerAlbumProps) => {
  const router = useRouter()
  const album = useQuery(session.queries.albumQuery(id))
  const page = routeState({ id, query: album })
  const back = () => router.back()
  const PageView = SERVER_ALBUM_VIEWS[page.state]
  return <PageView copy={ALBUM_COPY} onBack={back} page={page} session={session} />
}

/** `/album/[id]`: the cover, the artists and the facts, Play and Shuffle, and the tracks by disc. */
export const Album = () => {
  const session = useAppQueries()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  return session !== null && <ServerAlbum key={session.server.id} id={id} session={session} />
}
