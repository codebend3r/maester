import {
  type HomeShelf,
  type ItemSummary,
  type Library,
  type MediaItem,
  type ShowEntry,
  cardTitle,
  formatRuntime,
  resolutionLabel,
} from '@raven/core'
import { api } from '@/lib/api'
import { type AppPath, type WatchState, cardLink, showYears, watchLink } from '@/lib/itemLinks'
import { plural } from '@/lib/plural'

/** How many arrivals home's hero takes turns with. */
export const FEATURED_COUNT = 5

/** One of the arrivals home's hero shows: what it says, its pictures, and where its buttons go. */
export type Featured = {
  key: string
  /** The movie or show it is, whose words the hero reads. */
  itemId: number
  poster: string
  backdrop: string
  /** Where it arrived: "New in Movies". */
  eyebrow: string
  title: string
  /** The year, the length and the quality, or a show's years and episodes. */
  facts: string[]
  addedAt: string
  /** The video Play starts, handed over; null when a show has nothing left to watch. */
  play: { to: AppPath; state: WatchState } | null
  details: AppPath
}

/**
 * The poster for the fan and the backdrop for the wash behind it; null for
 * an item missing either, which the hero would have nothing to show for.
 */
const artworkOf = (item: ItemSummary): { poster: string; backdrop: string } | null => {
  const poster = api.itemImageUrl({ id: item.id, kind: 'poster', version: item.posterVersion })
  const backdrop = api.itemImageUrl({
    id: item.id,
    kind: 'backdrop',
    version: item.backdropVersion,
  })
  return poster && backdrop ? { poster, backdrop } : null
}

const isFact = (fact: string | null): fact is string => fact != null && fact !== ''

/** "4K HDR", "1080p", or null before the file is probed. */
const quality = (media: MediaItem): string | null => {
  const label = [resolutionLabel(media), media.hdr ? 'HDR' : null].filter(isFact).join(' ')
  return label === '' ? null : label
}

const fromMedia = ({ media, library }: { media: MediaItem; library: Library }): Featured[] => {
  const { item } = media
  if (!item) return []
  const artwork = artworkOf(item)
  if (!artwork) return []
  const { title, year } = cardTitle(media)
  return [
    {
      key: `media:${media.id}`,
      itemId: item.id,
      ...artwork,
      eyebrow: `New in ${library.name}`,
      title,
      facts: [
        year == null ? null : String(year),
        formatRuntime(media.duration),
        quality(media),
      ].filter(isFact),
      addedAt: media.addedAt,
      play: watchLink({ media }),
      details: cardLink({ media, pages: true }).to,
    },
  ]
}

const fromShow = ({ entry, library }: { entry: ShowEntry; library: Library }): Featured[] => {
  const { show, next } = entry
  const artwork = artworkOf(show)
  if (!artwork) return []
  return [
    {
      key: `show:${show.id}`,
      itemId: show.id,
      ...artwork,
      eyebrow: `New in ${library.name}`,
      title: show.title,
      facts: [
        showYears({ year: show.year, endedYear: entry.endedYear }),
        plural({ n: entry.episodes, one: 'episode', many: 'episodes' }),
      ].filter(isFact),
      addedAt: entry.addedAt,
      play: next ? watchLink({ media: next }) : null,
      details: `/shows/${show.id}`,
    },
  ]
}

/** A shelf's arrivals that have the pictures the hero needs, newest first, as the shelf has them. */
const candidates = ({ shelf, library }: { shelf: HomeShelf; library: Library }): Featured[] => {
  switch (shelf.type) {
    case 'shows':
      return shelf.shows.flatMap((entry) => fromShow({ entry, library }))
    case 'media':
      return shelf.media.flatMap((media) => fromMedia({ media, library }))
    default: {
      const unknown: never = shelf
      return unknown
    }
  }
}

const newestFirst = (a: Featured, b: Featured): number => b.addedAt.localeCompare(a.addedAt)

/**
 * What home's hero takes turns with: the newest arrival with a poster and a
 * backdrop from each pinned library, the most recent first, then each one's
 * second newest, and so on, up to `FEATURED_COUNT`. Taking from each library
 * in turn keeps one busy library from filling the hero on its own.
 */
export const featuredOf = (
  shelves: ReadonlyArray<{ shelf: HomeShelf; library: Library }>,
): Featured[] => {
  const lists = shelves.map(candidates)
  const depth = Math.max(0, ...lists.map((list) => list.length))
  return Array.from({ length: depth }, (_, round) =>
    lists.flatMap((list) => list.slice(round, round + 1)).toSorted(newestFirst),
  )
    .flat()
    .slice(0, FEATURED_COUNT)
}
