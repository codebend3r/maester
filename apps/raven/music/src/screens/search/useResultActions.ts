import {
  type AlbumSummary,
  type Artist,
  QUEUE_SOURCE_KINDS,
  type Track,
  artistNames,
} from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { WREN_PAGES, pageHref } from '@/routes'
import { RECENT_KINDS, useRecentSearches } from '@/stores/recentSearches'
import { toastFailure } from '@/stores/toast'
import type { WrenSession } from '@/useWren'

type PlaySongsProps = { tracks: readonly Track[]; startAt: number }

type UseResultActionsProps = { session: WrenSession; query: string }

/**
 * What opening a result does: an album or an artist opens its page and is remembered among the
 * recent searches; a song plays the songs found from it, remembering the words searched for.
 */
export const useResultActions = ({ session, query }: UseResultActionsProps) => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const playTracks = useAudioQueue((store) => store.playTracks)
  const remember = useRecentSearches((state) => state.remember)
  const rememberAlbum = (album: AlbumSummary) =>
    remember({
      kind: RECENT_KINDS.album,
      id: album.id,
      title: album.title,
      artists: artistNames(album),
    })
  const openAlbum = (album: AlbumSummary) => {
    rememberAlbum(album)
    router.push(pageHref({ page: WREN_PAGES.album, id: album.id }))
  }
  const openArtist = (artist: Artist) => {
    remember({ kind: RECENT_KINDS.artist, id: artist.id, name: artist.name })
    router.push(pageHref({ page: WREN_PAGES.artist, id: artist.id }))
  }
  const playSongs = ({ tracks, startAt }: PlaySongsProps) => {
    remember({ kind: RECENT_KINDS.query, text: query })
    playTracks({ tracks, startAt })
  }
  const playAlbum = (album: AlbumSummary) => {
    rememberAlbum(album)
    queryClient
      .fetchQuery(session.queries.albumQuery(album.id))
      .then((details) =>
        playTracks({
          tracks: details.tracks,
          source: { kind: QUEUE_SOURCE_KINDS.album, id: album.id },
        }),
      )
      .catch(toastFailure)
  }
  return { openAlbum, openArtist, playSongs, playAlbum }
}

export type ResultActions = ReturnType<typeof useResultActions>
