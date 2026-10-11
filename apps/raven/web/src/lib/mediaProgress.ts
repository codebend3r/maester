import type { MediaItem } from '@raven/core'

/** How far through the video playback stopped, as a fraction for the resume line. */
export const progressOf = (media: MediaItem): number =>
  media.duration != null && media.duration > 0 && media.position > 0
    ? Math.min(1, media.position / media.duration)
    : 0
