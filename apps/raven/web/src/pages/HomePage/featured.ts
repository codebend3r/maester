import {
  type AppPath,
  HOME_SHELF_TYPES,
  type Hero,
  type HeroEntry,
  type ItemSummary,
  type Library,
  type MediaItem,
  type ShowEntry,
  type WatchState,
  cardLink,
  cardTitle,
  formatRuntime,
  plural,
  resolutionLabel,
  showYears,
  watchLink,
} from '@raven/core'
import { api } from '@/lib/api'

/** One of the titles home's hero shows: what it says, its pictures, and where its buttons go. */
export type Featured = {
  key: string
  poster: string
  backdrop: string
  /** Where it is: "Featured in Movies". */
  eyebrow: string
  title: string
  /** The year, the length and the quality, or a show's years and episodes. */
  facts: string[]
  /** Its summary, else its tagline; null when it has neither. */
  line: string | null
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

const fromMedia = ({
  media,
  line,
  library,
}: {
  media: MediaItem
  line: string | null
  library: Library
}): Featured[] => {
  const { item } = media
  if (!item) return []
  const artwork = artworkOf(item)
  if (!artwork) return []
  const { title, year } = cardTitle(media)
  return [
    {
      key: `media:${media.id}`,
      ...artwork,
      eyebrow: `Featured in ${library.name}`,
      title,
      facts: [
        year == null ? null : String(year),
        formatRuntime(media.duration),
        quality(media),
      ].filter(isFact),
      line,
      play: watchLink({ media }),
      details: cardLink({ media, hasPages: true }).to,
    },
  ]
}

const fromShow = ({
  entry,
  line,
  library,
}: {
  entry: ShowEntry
  line: string | null
  library: Library
}): Featured[] => {
  const { show, next } = entry
  const artwork = artworkOf(show)
  if (!artwork) return []
  return [
    {
      key: `show:${show.id}`,
      ...artwork,
      eyebrow: `Featured in ${library.name}`,
      title: show.title,
      facts: [
        showYears({ year: show.year, endedYear: entry.endedYear }),
        plural({ n: entry.episodes, one: 'episode', many: 'episodes' }),
      ].filter(isFact),
      line,
      play: next ? watchLink({ media: next }) : null,
      details: `/shows/${show.id}`,
    },
  ]
}

/** The hero's entry as the slide it is, or nothing when its library is not among `libraries` or its pictures have no address. */
const featuredFrom = ({
  entry,
  libraries,
}: {
  entry: HeroEntry
  libraries: readonly Library[]
}): Featured[] => {
  const library = libraries.find(({ id }) => id === entry.libraryId)
  if (!library) return []
  switch (entry.type) {
    case HOME_SHELF_TYPES.shows:
      return fromShow({ entry: entry.entry, line: entry.line, library })
    case HOME_SHELF_TYPES.media:
      return fromMedia({ media: entry.media, line: entry.line, library })
    default: {
      const unknown: never = entry
      return unknown
    }
  }
}

/**
 * What home's hero takes turns with, as the server chose and ordered it: the
 * admin's picks, else each pinned library's newest release. The server holds
 * it to `HERO_COUNT`; this only gives each title its pictures' addresses and
 * its buttons.
 */
export const featuredOf = ({
  hero,
  libraries,
}: {
  hero: Hero
  libraries: readonly Library[]
}): Featured[] => hero.flatMap((entry) => featuredFrom({ entry, libraries }))
