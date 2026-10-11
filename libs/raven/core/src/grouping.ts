import { resolutionLabel } from '@/media'
import { codecLabel } from '@/playback'
import type { MediaGroupBy, MediaItem } from '@/types'

/** One bucket of the grouped view, its videos in the order they came in. */
export type MediaGroup = {
  key: string
  label: string
  items: MediaItem[]
}

/** Resolution buckets from the largest frame down, as the cards label them. */
const RESOLUTIONS: readonly string[] = ['4K', '1080p', '720p', '480p', 'SD']

const UNPROBED = { key: 'unprobed', label: 'Not probed yet' }

// Months are read in UTC, as the server stamps them, so every client groups
// a video the same way whatever its own time zone.
const monthName = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A video's bucket, or null when it has not been probed far enough to have one. */
const KEYS: Record<MediaGroupBy, (item: MediaItem) => string | null> = {
  resolution: (item) => resolutionLabel(item),
  codec: (item) => item.videoCodec,
  month: (item) => item.addedAt.slice(0, 7),
}

const LABELS: Record<MediaGroupBy, (key: string) => string> = {
  resolution: (key) => key,
  codec: (key) => codecLabel(key),
  month: (key) => monthName.format(new Date(`${key}-01T00:00:00.000Z`)),
}

const isUnprobed = (group: MediaGroup): boolean => group.key === UNPROBED.key

const unprobedLast = (a: MediaGroup, b: MediaGroup): number =>
  Number(isUnprobed(a)) - Number(isUnprobed(b))

const ORDER: Record<MediaGroupBy, (a: MediaGroup, b: MediaGroup) => number> = {
  resolution: (a, b) =>
    unprobedLast(a, b) || RESOLUTIONS.indexOf(a.key) - RESOLUTIONS.indexOf(b.key),
  codec: (a, b) =>
    unprobedLast(a, b) || b.items.length - a.items.length || a.label.localeCompare(b.label),
  month: (a, b) => unprobedLast(a, b) || b.key.localeCompare(a.key),
}

/**
 * Buckets videos for the grouped view. Videos keep their order inside a
 * bucket, so the library's sort still applies; the buckets themselves go
 * largest resolution first, most common codec first, or newest month first,
 * with anything not yet probed at the end.
 */
export const groupMedia = ({
  items,
  by,
}: {
  items: MediaItem[]
  by: MediaGroupBy
}): MediaGroup[] => {
  const keyOf = KEYS[by]
  return [...new Set(items.map(keyOf))]
    .map((key): MediaGroup => ({
      key: key ?? UNPROBED.key,
      label: key === null ? UNPROBED.label : LABELS[by](key),
      items: items.filter((item) => keyOf(item) === key),
    }))
    .toSorted(ORDER[by])
}
