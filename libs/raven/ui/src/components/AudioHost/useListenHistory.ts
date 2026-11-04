import type { ApiClient, Track } from '@raven/core'
import { useEffect, useEffectEvent, useRef } from 'react'
import { AUDIO_STATES, useAudioQueue } from '@/stores/audioQueue'

/** How much further a listen gets before the history hears of it again, in seconds. */
export const LISTEN_REPORT_STEP_S = 15

/** A track heard this far through and then back at its top is playing again, as repeat one plays it. */
const REPLAY_AFTER = 0.9

/** How near its top a track must be to count as starting over, in seconds. */
const TOP_S = 1

/** One sitting with a track: which track, its id once the server answers, and how far it got. */
type Listen = {
  trackId: number
  id: Promise<number | null>
  furthest: number
  reported: number
}

type ReportProps = { api: ApiClient; listen: Listen }

/** Tells the history how far `listen` got, when it got further than it last said; the listen as reported. */
const report = ({ api, listen }: ReportProps): Listen => {
  if (listen.furthest <= listen.reported) return listen
  const position = listen.furthest
  listen.id
    .then((id) => (id === null ? undefined : api.reportListen({ id, position })))
    .catch(() => undefined)
  return { ...listen, reported: position }
}

type IsReplayProps = { listen: Listen; position: number; duration: number | null }

const isReplay = ({ listen, position, duration }: IsReplayProps): boolean =>
  duration !== null && listen.furthest >= duration * REPLAY_AFTER && position < TOP_S

type UseListenHistoryProps = {
  api: ApiClient
  track: Track | null
}

/**
 * Keeps the play history of every track that plays, however briefly: a
 * listen starts as the track starts playing, and its reach is reported as it
 * plays on, when it pauses, and when another track takes over. A track
 * heard to its end and started again (repeat one, or the same track queued
 * twice) is a new listen; a seek back within it is not.
 */
export const useListenHistory = ({ api, track }: UseListenHistoryProps) => {
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const isPlaying = useAudioQueue((store) => store.state === AUDIO_STATES.playing)
  const listen = useRef<Listen | null>(null)
  const id = track?.id ?? null

  const finish = useEffectEvent(() => {
    if (listen.current) listen.current = report({ api, listen: listen.current })
  })

  useEffect(() => {
    if (id === null || !isPlaying) return
    const current = listen.current
    const isSame =
      current !== null &&
      current.trackId === id &&
      !isReplay({ listen: current, position, duration })
    if (current && isSame) {
      const moved = { ...current, furthest: Math.max(current.furthest, position) }
      listen.current =
        moved.furthest - moved.reported >= LISTEN_REPORT_STEP_S
          ? report({ api, listen: moved })
          : moved
      return
    }
    if (current) report({ api, listen: current })
    listen.current = {
      trackId: id,
      id: api.startListen({ mediaId: id, position }).catch(() => null),
      furthest: position,
      reported: position,
    }
  }, [api, id, isPlaying, position, duration])

  useEffect(() => {
    if (!isPlaying) finish()
  }, [isPlaying])

  useEffect(() => () => finish(), [])
}
