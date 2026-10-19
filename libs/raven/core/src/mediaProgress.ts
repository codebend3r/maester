import type { MediaItem } from '@/contract'

/** How far through the video playback stopped, as a fraction for the resume line. */
export const progressOf = (media: MediaItem): number =>
  media.duration != null && media.duration > 0 && media.position > 0
    ? Math.min(1, media.position / media.duration)
    : 0

/**
 * What is left of a video from where playback stopped, in whole minutes, as
 * "62 min left"; null for one not started. A last few seconds round up to a
 * minute rather than down to none.
 */
export const timeLeftOf = (media: MediaItem): string | null => {
  const progress = progressOf(media)
  if (progress <= 0 || progress >= 1 || media.duration == null) return null
  const minutes = Math.max(1, Math.round((media.duration - media.position) / 60))
  return `${minutes} min left`
}
