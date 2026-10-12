import type { MediaItem, MediaSort, ShowEntry, SortFieldName } from '@/contract'
import { formatBitrate, formatBytes, timeAgo } from '@/format'
import { resolutionLabel } from '@/media'
import { sortParts } from '@/sortFields'

type Fact = (args: { media: MediaItem; now: Date }) => string | null

const added: Fact = ({ media, now }) =>
  `Added ${timeAgo({ at: media.addedAt, now, style: 'long' })}`
const changed: Fact = ({ media, now }) =>
  `Changed ${timeAgo({ at: media.changedAt, now, style: 'long' })}`
const size: Fact = ({ media }) => formatBytes(media.size)
const bitrate: Fact = ({ media }) => formatBitrate(media.bitrate)
const resolution: Fact = ({ media }) => resolutionLabel(media)
const none: Fact = () => null

/**
 * What a card says of the value its listing is sorted by, one entry per
 * field, whichever way it runs. The title, year and score are on the cards
 * already, and a random order has no value to show.
 */
const FIELD_FACTS: Record<SortFieldName, Fact> = {
  title: none,
  added,
  changed,
  size,
  bitrate,
  resolution,
  release: none,
  rating: none,
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
}): string | null => FIELD_FACTS[sortParts(sort).field]({ media, now })

/** The same for a show: when its newest episode came, or its files' mean bitrate, for the sorts by those. */
export const showSortFact = ({
  entry,
  sort,
  now = new Date(),
}: {
  entry: ShowEntry
  sort: MediaSort
  now?: Date
}): string | null => {
  const { field } = sortParts(sort)
  switch (field) {
    case 'added':
      return `Added ${timeAgo({ at: entry.addedAt, now, style: 'long' })}`
    case 'bitrate':
      return formatBitrate(entry.bitrate)
    case 'title':
    case 'changed':
    case 'size':
    case 'resolution':
    case 'release':
    case 'rating':
    case 'random':
      return null
    default: {
      const unknown: never = field
      return unknown
    }
  }
}
