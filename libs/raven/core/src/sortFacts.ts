import {
  type MediaItem,
  type MediaSort,
  SORT_FIELD_NAMES,
  type ShowEntry,
  type SortFieldName,
} from '@/contract'
import { TIME_AGO_STYLES, formatBitrate, formatBytes, timeAgo } from '@/format'
import { formatAirDate } from '@/itemFacts'
import { resolutionLabel } from '@/media'
import { sortParts } from '@/sortFields'

type FactProps = { media: MediaItem; now: Date }

type Fact = (args: FactProps) => string | null

const added: Fact = ({ media, now }) =>
  `Added ${timeAgo({ at: media.addedAt, now, style: TIME_AGO_STYLES.long })}`
const changed: Fact = ({ media, now }) =>
  `Changed ${timeAgo({ at: media.changedAt, now, style: TIME_AGO_STYLES.long })}`
const size: Fact = ({ media }) => formatBytes(media.size)
const bitrate: Fact = ({ media }) => formatBitrate(media.bitrate)
const resolution: Fact = ({ media }) => resolutionLabel(media)
const release: Fact = ({ media }) => formatAirDate(media.item?.released ?? null)
const none: Fact = () => null

/**
 * What a card says of the value its listing is sorted by, one entry per
 * field, whichever way it runs. The title and score are on the cards
 * already, and a random order has no value to show. A release sort shows the
 * whole day, which the card's year then gives way to.
 */
const FIELD_FACTS: Record<SortFieldName, Fact> = {
  title: none,
  added,
  changed,
  size,
  bitrate,
  resolution,
  release,
  rating: none,
  random: none,
}

type SortFactProps = {
  media: MediaItem
  sort: MediaSort
  now?: Date
}

/**
 * The value a video's card shows for the order its listing is in, so the
 * order explains itself: "Added 3 days ago", "4.9 GB", "12.3 Mb/s", "2160p",
 * "Mar 7, 2026". Null when the card shows it already, the file has not been
 * probed yet, or TMDB gave no release day.
 */
export const sortFact = ({ media, sort, now = new Date() }: SortFactProps): string | null =>
  FIELD_FACTS[sortParts(sort).field]({ media, now })

type ShowSortFactProps = {
  entry: ShowEntry
  sort: MediaSort
  now?: Date
}

type CardSortFactProps = { media: MediaItem; sort: MediaSort | undefined }

type CardSortFact = { sorted: string | null; isYearSaid: boolean }

/**
 * A card's `sortFact`, for a listing in any order or none, and whether it
 * says the card's year already: a release sort's day does, so the card
 * leaves its year out.
 */
export const cardSortFact = ({ media, sort }: CardSortFactProps): CardSortFact => {
  const sorted = sort == null ? null : sortFact({ media, sort })
  return {
    sorted,
    isYearSaid:
      sorted != null && sort != null && sortParts(sort).field === SORT_FIELD_NAMES.release,
  }
}

/** The same for a show: when its newest episode came, when it first aired, or its files' mean bitrate, for the sorts by those. */
export const showSortFact = ({
  entry,
  sort,
  now = new Date(),
}: ShowSortFactProps): string | null => {
  const { field } = sortParts(sort)
  switch (field) {
    case SORT_FIELD_NAMES.added:
      return `Added ${timeAgo({ at: entry.addedAt, now, style: TIME_AGO_STYLES.long })}`
    case SORT_FIELD_NAMES.bitrate:
      return formatBitrate(entry.bitrate)
    case SORT_FIELD_NAMES.release:
      return formatAirDate(entry.show.released ?? null)
    case SORT_FIELD_NAMES.title:
    case SORT_FIELD_NAMES.changed:
    case SORT_FIELD_NAMES.size:
    case SORT_FIELD_NAMES.resolution:
    case SORT_FIELD_NAMES.rating:
    case SORT_FIELD_NAMES.random:
      return null
    default: {
      const unknown: never = field
      return unknown
    }
  }
}
