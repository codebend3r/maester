import {
  type AppPath,
  HOME_SHELF_TYPES,
  type Hero,
  type HeroEntry,
  type ItemSummary,
  type Library,
  type MediaItem,
  type FactPart,
  type ShowEntry,
  type WatchState,
  cardLink,
  cardTitle,
  formatRuntime,
  pictureParts,
  showYears,
  watchLink,
  ITEM_IMAGE_KINDS,
  showPath,
} from '@raven/core'
import { api } from '@/lib/api'
import { HOME_COPY } from '@/pages/HomePage/copy'
import { COMMON_COPY } from '@/lib/copy'

/** One of the titles home's hero shows: what it says, its pictures, and where its buttons go. */
export type Featured = {
  key: string
  poster: string
  backdrop: string
  /** The backdrop's narrower copies from the image CDN, or null where there is none. */
  backdropSrcSet: string | null
  /** Where it is: "Featured in Movies". */
  eyebrow: string
  title: string
  /** The release day (or year) and the length, or a show's years and episodes. */
  facts: string[]
  /** A movie's resolution, range and codec as chips; none for a show, or a file not yet probed. */
  picture: FactPart[]
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
const artworkOf = (
  item: ItemSummary,
): Pick<Featured, 'poster' | 'backdrop' | 'backdropSrcSet'> | null => {
  const poster = api.itemImageUrl({
    id: item.id,
    kind: ITEM_IMAGE_KINDS.poster,
    version: item.posterVersion,
  })
  const backdrop = api.itemImageUrl({
    id: item.id,
    kind: ITEM_IMAGE_KINDS.backdrop,
    version: item.backdropVersion,
  })
  if (!poster || !backdrop) return null
  return {
    poster,
    backdrop,
    backdropSrcSet: api.backdropSrcSet({ id: item.id, version: item.backdropVersion }),
  }
}

const isFact = (fact: string | null): fact is string => fact != null && fact !== ''

type FromMediaProps = {
  media: MediaItem
  line: string | null
  library: Library
}

const fromMedia = ({ media, line, library }: FromMediaProps): Featured[] => {
  const { item } = media
  if (!item) return []
  const artwork = artworkOf(item)
  if (!artwork) return []
  const { title, date } = cardTitle(media)
  return [
    {
      key: `media:${media.id}`,
      ...artwork,
      eyebrow: HOME_COPY.featuredIn(library.name),
      title,
      facts: [date, formatRuntime(media.duration)].filter(isFact),
      picture: pictureParts(media),
      line,
      play: watchLink({ media }),
      details: cardLink({ media, hasPages: true }).to,
    },
  ]
}

type FromShowProps = {
  entry: ShowEntry
  line: string | null
  library: Library
}

const fromShow = ({ entry, line, library }: FromShowProps): Featured[] => {
  const { show, next } = entry
  const artwork = artworkOf(show)
  if (!artwork) return []
  return [
    {
      key: `show:${show.id}`,
      ...artwork,
      eyebrow: HOME_COPY.featuredIn(library.name),
      title: show.title,
      facts: [
        showYears({ year: show.year, endedYear: entry.endedYear }),
        COMMON_COPY.episodes(entry.episodes),
      ].filter(isFact),
      picture: [],
      line,
      play: next ? watchLink({ media: next }) : null,
      details: showPath(show.id),
    },
  ]
}

type FeaturedFromProps = {
  entry: HeroEntry
  libraries: readonly Library[]
}

/** The hero's entry as the slide it is, or nothing when its library is not among `libraries` or its pictures have no address. */
const featuredFrom = ({ entry, libraries }: FeaturedFromProps): Featured[] => {
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

type FeaturedOfProps = {
  hero: Hero
  libraries: readonly Library[]
}

/**
 * What home's hero takes turns with, as the server chose and ordered it: the
 * admin's picks, else each pinned library's newest release. The server holds
 * it to `HERO_COUNT`; this only gives each title its pictures' addresses and
 * its buttons.
 */
export const featuredOf = ({ hero, libraries }: FeaturedOfProps): Featured[] =>
  hero.flatMap((entry) => featuredFrom({ entry, libraries }))
