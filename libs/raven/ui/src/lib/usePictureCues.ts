import { useQueries } from '@tanstack/react-query'
import {
  type ApiClient,
  type PictureCue,
  type SubtitleTrack,
  mergePictureCues,
  subtitleWindows,
} from '@raven/core'
import { type SubtitleAccessReader, playerQueriesFor } from '@/lib/playerQueries'

type UsePictureCuesProps = {
  video: {
    api: ApiClient
    mediaId: number
    readAccess?: SubtitleAccessReader
  } | null
  /** The picture track to read (core's `isOverlaySubtitle`), or null for none. */
  track: SubtitleTrack | null
  time: number
  duration: number | null
}

/**
 * The picture cues around `time` for one picture track of a server's video, as `useTrackCues`
 * reads a text track's: the window playing plus the next as it draws near, each kept in the
 * query cache while it is near. No video or no track asks for nothing, and a window the server
 * refuses (an older server knows no picture cues) draws nothing.
 */
export const usePictureCues = ({
  video,
  track,
  time,
  duration,
}: UsePictureCuesProps): PictureCue[] => {
  const queries = (() => {
    if (track == null || video == null) return []
    const { pictureSubtitles } = playerQueriesFor(video.api)
    return subtitleWindows({ time, duration }).map((window) =>
      pictureSubtitles({
        id: video.mediaId,
        trackId: track.id,
        window,
        readAccess: video.readAccess,
      }),
    )
  })()
  return useQueries({
    queries,
    combine: (results) =>
      results.reduce<PictureCue[]>(
        (merged, result) =>
          result.data ? mergePictureCues({ existing: merged, incoming: result.data }) : merged,
        [],
      ),
  })
}
