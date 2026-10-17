import type { PlayerEvent } from '@raven/core'
import type { Ranges, VideoEvent } from '@/components/Player/useVideoState'

export const rangesFrom = (ranges: readonly { start: number; end: number }[]): Ranges =>
  ranges.map(({ start, end }): [number, number] => [start, end])

/**
 * What mpv's events mean to the video reducer. `buffered` is the last ranges
 * seen, which every clock tick carries along as the html engine's does. Tracks
 * and errors are the engine's own business, not the reducer's.
 */
export const fromPlayerEvent = ({
  event,
  buffered,
}: {
  event: PlayerEvent
  buffered: Ranges
}): VideoEvent | null => {
  switch (event.type) {
    case 'time':
      return { type: 'moved', time: event.time, buffered }
    case 'buffered':
      return { type: 'buffered', buffered: rangesFrom(event.ranges) }
    case 'paused':
      return { type: event.paused ? 'paused' : 'played' }
    case 'waiting':
      return { type: event.waiting ? 'waiting' : 'flowing' }
    case 'duration':
      return {
        type: 'duration',
        duration: event.duration != null && event.duration > 0 ? event.duration : null,
      }
    case 'rate':
      return { type: 'rate', rate: event.rate }
    case 'ended':
      return { type: 'ended' }
    case 'tracks':
    case 'error':
      return null
    default: {
      const unknown: never = event
      return unknown
    }
  }
}
