import {
  type AlbumDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  routeIdOf,
  routeState,
} from '@raven/core'
import { playingTrackOf, useAudioQueue, useServerAlbumFavourite } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { AlbumLayout, ItemNotice } from '@/layouts'
import { albumDiscsOf, albumFactsOf } from '@/layouts/musicRows'
import { usePlaylistAdd } from '@/music/usePlaylistAdd'
import { pictureAt } from '@/queries/cards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'

const COPY = {
  opening: 'Opening the album',
  missing: 'This album is not on the server.',
} as const

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

type ServerAlbumProps = { session: AppQueries; id: number | null }

const ServerAlbum = ({ session, id }: ServerAlbumProps) => {
  const router = useRouter()
  const album = useQuery(session.queries.albumQuery(id))
  const page = routeState({ id, query: album })
  const back = () => router.back()
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <ItemNotice notice={COPY.missing} onBack={back} />
    case ROUTE_STATES.error:
      return <ItemNotice notice={page.message} onBack={back} />
    case ROUTE_STATES.loading:
      return <ItemNotice notice={COPY.opening} onBack={back} />
    case ROUTE_STATES.ready:
      return <AlbumPage details={page.data} session={session} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/** `/album/[id]`: the cover, the artists and the facts, Play and Shuffle, and the tracks by disc. */
export const Album = () => {
  const session = useAppQueries()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  if (session === null) return null
  return <ServerAlbum key={session.server.id} id={id} session={session} />
}
