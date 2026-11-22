import { type AlbumSummary, albumDateLabel } from '@raven/core'

import { HOME_COPY } from '@/copy/screens'
import { RECENT_SORTS, type RecentSort } from '@/prefs'

// When an album was added is a moment, so it reads as the listener's own day, in raven's words.
const ADDED_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

/** The day an album was added, or nothing for a time that does not read. */
const addedTextOf = ({ addedAt }: AlbumSummary): string | null => {
  const at = new Date(addedAt)
  return Number.isNaN(at.getTime()) ? null : ADDED_DAY.format(at)
}

type DateLineOf = (album: AlbumSummary) => string

const RECENT_DATE_LINES = {
  [RECENT_SORTS.release]: (album) => {
    const date = albumDateLabel(album)
    return date === null ? HOME_COPY.dates.releaseUnknown : HOME_COPY.dates.released(date)
  },
  [RECENT_SORTS.added]: (album) => {
    const date = addedTextOf(album)
    return date === null ? HOME_COPY.dates.addedUnknown : HOME_COPY.dates.added(date)
  },
} as const satisfies Record<RecentSort, DateLineOf>

type RecentDateLineProps = { album: AlbumSummary; sort: RecentSort }

/** The date Home's albums are ordered by, for a tile: "Released May 3, 2024", "Added November 20, 2026". */
export const recentDateLineOf = ({ album, sort }: RecentDateLineProps): string =>
  RECENT_DATE_LINES[sort](album)
