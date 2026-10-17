import { SUBTITLE_SOURCES, type MediaTracks, type SubtitleTrack } from '@raven/core'
import { isSidecarTrackId } from '@/shared/protocol'

/**
 * The server's own subtitle files beside the video: embedded tracks come from the file.
 * The server names its sidecars `external-N` (Ruling 18), and nothing else goes into a path.
 */
export const sidecarTracksOf = (tracks: MediaTracks): SubtitleTrack[] =>
  tracks.subtitles.filter(
    (track) => track.source === SUBTITLE_SOURCES.external && isSidecarTrackId(track.id),
  )
