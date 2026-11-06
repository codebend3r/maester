import { ITEM_TYPES, type MediaItem, formatRuntime, mediaLabel, resolutionLabel } from '@raven/core'

import type { Picture } from '@/queries/cards'
import { episodeMarkOf } from '@/queries/episodeMark'

/**
 * The player's title as lines: an episode's show over its season and number, then its own name;
 * anything else its name alone. `length` is the runtime for the chip beside the name, `quality`
 * the file's resolution for the chip under it, and `logo` the show's title art, drawn in place of
 * its name where it has one.
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
}

type PlayerHeadingOfProps = { media: MediaItem; logo: Picture | null }

/** The heading over a playing video: "Slow Horses", "S01 · E03", "Bad Tradecraft". */
export const playerHeadingOf = ({ media, logo }: PlayerHeadingOfProps): PlayerHeading => {
  const { item } = media
  const length = formatRuntime(media.duration)
  const quality = resolutionLabel({ width: media.width, height: media.height })
  if (item !== null && item.type === ITEM_TYPES.episode) {
    return {
      show: item.show?.title ?? null,
      logo,
      place: episodeMarkOf({ season: item.season, episode: item.episode }),
      title: item.title,
      length,
      quality,
    }
  }
  return { show: null, logo, place: null, title: mediaLabel(media), length, quality }
}

/** The heading of the player's page while nothing plays: no title at all. */
export const NO_HEADING: PlayerHeading = {
  show: null,
  logo: null,
  place: null,
  title: '',
  length: null,
  quality: null,
}
