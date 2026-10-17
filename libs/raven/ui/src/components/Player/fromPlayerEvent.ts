import { PLAYER_EVENTS, type PlayerEvent } from '@raven/core'
import { type Ranges, VIDEO_EVENTS, type VideoEvent } from '@/components/Player/useVideoState'

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
    case PLAYER_EVENTS.time:
      return { type: VIDEO_EVENTS.moved, time: event.time, buffered }
    case PLAYER_EVENTS.buffered:
      return { type: VIDEO_EVENTS.buffered, buffered: rangesFrom(event.ranges) }
    case PLAYER_EVENTS.paused:
      return { type: event.paused ? VIDEO_EVENTS.paused : VIDEO_EVENTS.played }
    case PLAYER_EVENTS.waiting:
      return { type: event.waiting ? VIDEO_EVENTS.waiting : VIDEO_EVENTS.flowing }
    case PLAYER_EVENTS.duration:
      return {
        type: VIDEO_EVENTS.duration,
        duration: event.duration != null && event.duration > 0 ? event.duration : null,
      }
    case PLAYER_EVENTS.rate:
      return { type: VIDEO_EVENTS.rate, rate: event.rate }
    case PLAYER_EVENTS.ended:
      return { type: VIDEO_EVENTS.ended }
    case PLAYER_EVENTS.tracks:
    case PLAYER_EVENTS.error:
      return null
    default: {
      const unknown: never = event
      return unknown
    }
  }
}
