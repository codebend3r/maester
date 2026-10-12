import type { MediaItem, MediaSort, ShowEntry } from '@/contract'
import { formatBitrate, formatBytes, timeAgo } from '@/format'
import { resolutionLabel } from '@/media'

type Fact = (args: { media: MediaItem; now: Date }) => string | null

const added: Fact = ({ media, now }) =>
  `Added ${timeAgo({ at: media.addedAt, now, style: 'long' })}`
const size: Fact = ({ media }) => formatBytes(media.size)
const bitrate: Fact = ({ media }) => formatBitrate(media.bitrate)
const resolution: Fact = ({ media }) => resolutionLabel(media)
const none: Fact = () => null

/**
 * What a card says of the value its listing is sorted by, one entry per
 * sort. The title, year and score are on the cards already, and a random
 * order has no value to show.
 */
const MEDIA_SORT_FACTS: Record<MediaSort, Fact> = {
  title: none,
  added,
  oldest: added,
  changed: ({ media, now }) => `Changed ${timeAgo({ at: media.changedAt, now, style: 'long' })}`,
  largest: size,
  smallest: size,
  'bitrate-high': bitrate,
  'bitrate-low': bitrate,
  'resolution-high': resolution,
  'resolution-low': resolution,
  'year-new': none,
  'year-old': none,
  'rating-high': none,
  'rating-low': none,
  random: none,
}

/**
 * The value a video's card shows for the order its listing is in, so the
 * order explains itself: "Added 3 days ago", "4.9 GB", "12.3 Mb/s", "2160p".
 * Null when the card shows it already or the file has not been probed yet.
 */
export const sortFact = ({
  media,
  sort,
  now = new Date(),
}: {
  media: MediaItem
  sort: MediaSort
  now?: Date
}): string | null => MEDIA_SORT_FACTS[sort]({ media, now })

/** The same for a show: when its newest episode came, for the sorts by when shows were added. */
export const showSortFact = ({
  entry,
  sort,
  now = new Date(),
}: {
  entry: ShowEntry
  sort: MediaSort
  now?: Date
}): string | null =>
  sort === 'added' || sort === 'oldest'
    ? `Added ${timeAgo({ at: entry.addedAt, now, style: 'long' })}`
    : null
