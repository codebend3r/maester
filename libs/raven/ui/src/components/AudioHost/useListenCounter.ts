import type { ApiClient, Track } from '@raven/core'
import { useEffect, useRef } from 'react'
import { useAudioQueue } from '@/stores/audioQueue'

/** A track counts as listened to this far in, or halfway, whichever comes first: the Last.fm rule. */
export const LISTEN_AFTER_S = 240

/** How far in counts as a listen, for a track of `duration` seconds; null while the length is unknown. */
export const listenPointOf = (duration: number | null): number | null =>
  duration === null ? null : Math.min(duration / 2, LISTEN_AFTER_S)

type UseListenCounterProps = {
  api: ApiClient
  track: Track | null
}

/** Records a listen once per track, at half its length or four minutes in, from what the engine reports. */
export const useListenCounter = ({ api, track }: UseListenCounterProps) => {
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const listened = useRef<number | null>(null)
  const id = track?.id ?? null
  useEffect(() => {
    const point = listenPointOf(duration)
    if (id === null || point === null || position < point || listened.current === id) return
    listened.current = id
    api.recordPlay(id).catch(() => undefined)
  }, [api, id, position, duration])
}
