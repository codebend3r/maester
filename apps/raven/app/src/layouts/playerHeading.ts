import {
  ITEM_TYPES,
  type MediaItem,
  codecLabel,
  formatRuntime,
  mediaLabel,
  rangeLabel,
  resolutionLabel,
  episodeTag,
} from '@raven/core'

import type { Picture } from '@/queries/cards'

/**
 * The player's title as lines: an episode's show over its own name, then its season and number;
 * anything else its name alone. `length` is the runtime and `year` the release year for the line
 * of what it is, `quality`, `codec` and `range` the file's picture for its chips, and `logo` the
 * show's title art, drawn in place of its name where it has one.
 */
export type PlayerHeading = {
  show: string | null
  /** The show's title art, or a film's own, drawn in place of its name where it has one. */
  logo: Picture | null
  place: string | null
  title: string
  length: string | null
  /** "4K", "1080p", "720p": the file's resolution, null when the index has no frame size. */
  quality: string | null
  /** "HEVC": the file's video codec, null when the index does not know it. */
  codec: string | null
  /** "HDR", "DV5": the file's range of light, null for SDR. */
  range: string | null
  /** The release year, null when unknown or when the title already ends with it. */
  year: string | null
}

type PlayerHeadingOfProps = { media: MediaItem; logo: Picture | null }

/** The heading over a playing video: "Slow Horses", "S01 · E03", "Bad Tradecraft". */
export const playerHeadingOf = ({ media, logo }: PlayerHeadingOfProps): PlayerHeading => {
  const { item } = media
  const picture = {
    length: formatRuntime(media.duration),
    quality: resolutionLabel({ width: media.width, height: media.height }),
    codec: media.videoCodec ? codecLabel(media.videoCodec) : null,
    range: rangeLabel(media),
  }
  const year = item?.year ?? media.year
  if (item !== null && item.type === ITEM_TYPES.episode) {
    return {
      show: item.show?.title ?? null,
      logo,
      place: episodeTag({ season: item.season, episode: item.episode }),
      title: item.title,
      ...picture,
      year: year === null ? null : String(year),
    }
  }
  const title = mediaLabel(media)
  const isYearInTitle = year === null || title.includes(`(${year})`)
  return {
    show: null,
    logo,
    place: null,
    title,
    ...picture,
    year: isYearInTitle ? null : String(year),
  }
}

/** The heading of the player's page while nothing plays: no title at all. */
export const NO_HEADING: PlayerHeading = {
  show: null,
  logo: null,
  place: null,
  title: '',
  length: null,
  quality: null,
  codec: null,
  range: null,
  year: null,
}
