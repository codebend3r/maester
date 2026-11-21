import { type AlbumSummary, type Artist, QUEUE_SOURCE_KINDS, type Track } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { RECENT_KINDS, recentOfAlbum, recentOfArtist } from '@raven/wren'
import { useRouter } from 'expo-router'

import { useAlbumTracks } from '@/music/useAlbumTracks'
import { WREN_PAGES, pageHref } from '@/routes'
import { useRecentSearches } from '@/stores/recentSearches'
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
  const albumTracks = useAlbumTracks(session)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const remember = useRecentSearches((state) => state.remember)
  const rememberAlbum = (album: AlbumSummary) => remember(recentOfAlbum(album))
  const openAlbum = (album: AlbumSummary) => {
    rememberAlbum(album)
    router.push(pageHref({ page: WREN_PAGES.album, id: album.id }))
  }
  const openArtist = (artist: Artist) => {
    remember(recentOfArtist(artist))
    router.push(pageHref({ page: WREN_PAGES.artist, id: artist.id }))
  }
  const playSongs = ({ tracks, startAt }: PlaySongsProps) => {
    remember({ kind: RECENT_KINDS.query, text: query })
    playTracks({ tracks, startAt })
  }
  const playAlbum = (album: AlbumSummary) => {
    rememberAlbum(album)
    albumTracks([album.id])
      .then((tracks) =>
        playTracks({
          tracks,
          source: { kind: QUEUE_SOURCE_KINDS.album, id: album.id },
        }),
      )
      .catch(toastFailure)
  }
  return { openAlbum, openArtist, playSongs, playAlbum }
}

export type ResultActions = ReturnType<typeof useResultActions>
