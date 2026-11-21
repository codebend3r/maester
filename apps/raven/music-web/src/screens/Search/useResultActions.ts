import { type AlbumSummary, type Artist, QUEUE_SOURCE_KINDS, type Track } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { RECENT_KINDS, recentOfAlbum, recentOfArtist } from '@raven/wren'
import { useAlbumTracks } from '@/music/useAlbumTracks'
import { useRecentSearches } from '@/stores/recentSearches'
import { toastFailure } from '@/stores/toast'

type PlaySongsProps = { tracks: readonly Track[]; startAt: number }

type UseResultActionsProps = { query: string }

/**
 * What a result does beside what its press opens: an album or an artist, which is a link to its
 * page, is remembered among the recent searches on the way; a song plays the songs found from
 * it, remembering the words searched for.
 */
export const useResultActions = ({ query }: UseResultActionsProps) => {
  const albumTracks = useAlbumTracks()
  const playTracks = useAudioQueue((store) => store.playTracks)
  const remember = useRecentSearches((state) => state.remember)
  const rememberAlbum = (album: AlbumSummary) => remember(recentOfAlbum(album))
  const rememberArtist = (artist: Artist) => remember(recentOfArtist(artist))
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
  return { rememberAlbum, rememberArtist, playSongs, playAlbum }
}

export type ResultActions = ReturnType<typeof useResultActions>
