import { type Track, artistNames } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'

import { type Cover, useCovers } from '@/music/useCovers'
import type { WrenSession } from '@/useWren'

/** The playing track as every player draws it: the mini player, the tablet's bar, the TV's sidebar, Now Playing. */
export type NowPlayingTrack = {
  track: Track
  cover: Cover | null
  /** "Radiohead", or every artist it credits. */
  artists: string
  /** How long it is, in seconds: the engine's once it knows, the library's until then. */
  length: number
  /** What went wrong playing, or null. */
  error: string | null
}

type UseNowPlayingProps = { session: Pick<WrenSession, 'server' | 'api'>; track: Track }

/** The playing track's cover, artists, length and error, which every player shows. */
export const useNowPlaying = ({ session, track }: UseNowPlayingProps): NowPlayingTrack => {
  const { trackCoverOf } = useCovers(session)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  return {
    track,
    cover: trackCoverOf(track),
    artists: artistNames(track),
    length: duration ?? track.duration ?? 0,
    error,
  }
}
