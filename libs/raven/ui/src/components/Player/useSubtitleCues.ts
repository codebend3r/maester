import { PLAYER_SOURCE_KINDS, type SubtitleCue, type SubtitleTrack } from '@raven/core'
import type { HtmlSource } from '@/components/Player/engine'
import { type SubtitleStatus, useTrackCues } from '@/lib/useTrackCues'

/** The cues around `time` for one track of what the browser plays; a local file has none here. */
export const useSubtitleCues = ({
  source,
  track,
  time,
  duration,
}: {
  source: HtmlSource
  track: SubtitleTrack | null
  time: number
  duration: number | null
}): { cues: SubtitleCue[]; status: SubtitleStatus } =>
  useTrackCues({
    video:
      source.kind === PLAYER_SOURCE_KINDS.server
        ? { api: source.api, mediaId: source.media.id }
        : null,
    track,
    time,
    duration,
  })
