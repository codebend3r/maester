import type { ApiClient, Track } from '@raven/core'
import { useListenCounter } from '@/components/AudioHost/useListenCounter'
import { useListenHistory } from '@/components/AudioHost/useListenHistory'

type UseTrackListeningProps = {
  api: ApiClient
  track: Track | null
}

/**
 * What every music host tells the server of the track playing: the listen
 * it counts, for the library's history and scrobbling, and every sitting,
 * however short, for the play history.
 */
export const useTrackListening = ({ api, track }: UseTrackListeningProps) => {
  useListenCounter({ api, track })
  useListenHistory({ api, track })
}
