import {
  HOME_SHELF_TYPES,
  type Hero,
  type HeroEntry,
  ITEM_IMAGE_KINDS,
  type ItemSummary,
  type Library,
  type MediaItem,
  type ShowEntry,
  cardTitle,
  formatRuntime,
  plural,
  showYears,
} from '@raven/core'

import { type Picture, type Pictures, imageOf, pictureAt, videoTarget } from '@/queries/cards'
import { HOME_HERO_COPY } from '@/queries/copy'
import { ROUTE_TARGETS, type RouteTarget, itemTarget } from '@/routes'

/** One of the titles Home's hero takes turns with, as the web's `Featured`. */
export type HeroSlide = {
  key: string
  /** Where it is: "Featured in Movies". */
  eyebrow: string
  title: string
  /** The release day and the length, or a show's years and episodes. */
  facts: string[]
  /** Its summary, else its tagline; null when it has neither. */
  line: string | null
  poster: Picture
  backdrop: Picture
  /** What Play starts; null when a show has nothing left to watch. */
  play: RouteTarget | null
  details: RouteTarget
}

type ArtworkOfProps = Pictures & { item: ItemSummary }

/** The poster for the fan and the backdrop for the wash; null for an item missing either. */
const artworkOf = ({ item, api, headersFor }: ArtworkOfProps) => {
  const poster = pictureAt({
    uri: imageOf({ api, item, kind: ITEM_IMAGE_KINDS.poster }),
    headersFor,
  })
  const backdrop = pictureAt({
    uri: imageOf({ api, item, kind: ITEM_IMAGE_KINDS.backdrop }),
    headersFor,
  })
  return poster === null || backdrop === null ? null : { poster, backdrop }
}

const isFact = (fact: string | null): fact is string => fact !== null && fact !== ''

const playOf = (media: MediaItem): RouteTarget => ({
  kind: ROUTE_TARGETS.play,
  mediaId: media.id,
  at: 0,
})

type FromMediaProps = Pictures & { media: MediaItem; line: string | null; library: Library }

const fromMedia = ({ media, line, library, ...pictures }: FromMediaProps): HeroSlide[] => {
  const { item } = media
  if (item === null) return []
  const artwork = artworkOf({ item, ...pictures })
  if (artwork === null) return []
  const { title, date } = cardTitle(media)
  return [
    {
      key: `media:${media.id}`,
      ...artwork,
      eyebrow: HOME_HERO_COPY.featuredIn(library.name),
      title,
      facts: [date, formatRuntime(media.duration)].filter(isFact),
      line,
      play: playOf(media),
      details: videoTarget({ media, hasPages: true }),
    },
  ]
}

type FromShowProps = Pictures & { entry: ShowEntry; line: string | null; library: Library }

const fromShow = ({ entry, line, library, ...pictures }: FromShowProps): HeroSlide[] => {
  const { show, next } = entry
  const artwork = artworkOf({ item: show, ...pictures })
  if (artwork === null) return []
  return [
    {
      key: `show:${show.id}`,
      ...artwork,
      eyebrow: HOME_HERO_COPY.featuredIn(library.name),
      title: show.title,
      facts: [
        showYears({ year: show.year, endedYear: entry.endedYear }),
        plural({ n: entry.episodes, ...HOME_HERO_COPY.episodes }),
      ].filter(isFact),
      line,
      play: next === null ? null : playOf(next),
      details: itemTarget(show.id),
    },
  ]
}

type SlideFromProps = Pictures & { entry: HeroEntry; libraries: readonly Library[] }

const slideFrom = ({ entry, libraries, ...pictures }: SlideFromProps): HeroSlide[] => {
  const library = libraries.find(({ id }) => id === entry.libraryId)
  if (library === undefined) return []
  switch (entry.type) {
    case HOME_SHELF_TYPES.shows:
      return fromShow({ entry: entry.entry, line: entry.line, library, ...pictures })
    case HOME_SHELF_TYPES.media:
      return fromMedia({ media: entry.media, line: entry.line, library, ...pictures })
    default: {
      const unknown: never = entry
      return unknown
    }
  }
}

type HeroSlidesOfProps = Pictures & { hero: Hero; libraries: readonly Library[] }

/**
 * What Home's hero takes turns with, in the server's order, as the web's `featuredOf`: a title
 * whose library is not listed, or that lacks a poster or a backdrop, is left out.
 */
export const heroSlidesOf = ({ hero, libraries, ...pictures }: HeroSlidesOfProps): HeroSlide[] =>
  hero.flatMap((entry) => slideFrom({ entry, libraries, ...pictures }))
