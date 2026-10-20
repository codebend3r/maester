import type { LibraryView, MediaGroupBy, SortDirection, SortFieldName } from '@/contract'
import type { JumpScale } from '@/jumpScale'
import type { DirectedSortFieldName } from '@/sortFields'

/** What each field a library sorts on is called in its sort menu. */
export const SORT_FIELD_LABELS: Record<SortFieldName, string> = {
  title: 'Title',
  added: 'Date added',
  changed: 'Date changed',
  size: 'File size',
  bitrate: 'Bitrate',
  resolution: 'Resolution',
  release: 'Release date',
  rating: 'Rating',
  random: 'Random',
}

/** How each way a field runs reads: A to Z, newest first. */
export const SORT_DIRECTION_LABELS: Record<DirectedSortFieldName, Record<SortDirection, string>> = {
  title: { ascending: 'A to Z', descending: 'Z to A' },
  added: { ascending: 'Oldest first', descending: 'Newest first' },
  changed: { ascending: 'Oldest first', descending: 'Newest first' },
  size: { ascending: 'Smallest first', descending: 'Largest first' },
  bitrate: { ascending: 'Lowest first', descending: 'Highest first' },
  resolution: { ascending: 'Lowest first', descending: 'Highest first' },
  release: { ascending: 'Oldest first', descending: 'Newest first' },
  rating: { ascending: 'Lowest first', descending: 'Highest first' },
}

/** What each layout of a library's listing is called. */
export const LIBRARY_VIEW_LABELS: Record<LibraryView, string> = {
  grid: 'Grid',
  covers: 'Covers',
  list: 'List',
  tiles: 'Tiles',
  grouped: 'Grouped',
}

/** What each grouping of the grouped view is called. */
export const GROUPING_LABELS: Record<MediaGroupBy, string> = {
  match: 'Matched or not',
  resolution: 'Resolution',
  codec: 'Video codec',
  month: 'Month added',
}

/** What the jump strip is called aloud, by what it jumps by. */
export const JUMP_SCALE_LABELS: Record<JumpScale['field'], string> = {
  title: 'Jump to a letter',
  added: 'Jump to when videos came',
  changed: 'Jump to when videos changed',
  size: 'Jump to a size',
  bitrate: 'Jump to a bitrate',
  resolution: 'Jump to a resolution',
  release: 'Jump to a year',
  rating: 'Jump to a score',
}

/** What a library's page says in place of a listing with nothing in it, or null while there is something. */
export const emptyListingMessage = ({
  isEmpty,
  query,
  isScanning,
}: {
  isEmpty: boolean
  query: string
  isScanning: boolean
}): string | null => {
  if (!isEmpty) return null
  if (query !== '') return `Nothing here matches "${query}".`
  if (isScanning) return 'Looking through the folders. Videos appear here as they are found.'
  return 'No videos in these folders yet. Check the paths, or add a folder that holds videos.'
}
