import { ITEM_TYPES, type MediaItem, episodePlace, formatRuntime, mediaLabel } from '@raven/core'

import type { Picture } from '@/queries/cards'

/**
 * The player's title as lines: an episode's show over its season and number, then its own name;
 * anything else its name alone. `length` is the runtime for the chip beside the name, and `logo`
 * the show's title art, drawn in place of its name where it has one.
 */
export type PlayerHeading = {
  show: string | null
  logo: Picture | null
  place: string | null
  title: string
  length: string | null
}

type PlayerHeadingOfProps = { media: MediaItem; logo: Picture | null }

/** The heading over a playing video: "Slow Horses", "Season 1, Episode 3", "Bad Tradecraft". */
export const playerHeadingOf = ({ media, logo }: PlayerHeadingOfProps): PlayerHeading => {
  const { item } = media
  const length = formatRuntime(media.duration)
  if (item?.type === ITEM_TYPES.episode) {
    return {
      show: item.show?.title ?? null,
      logo,
      place: episodePlace(media),
      title: item.title,
      length,
    }
  }
  return { show: null, logo: null, place: null, title: mediaLabel(media), length }
}

/** The heading of the player's page while nothing plays: no title at all. */
export const NO_HEADING: PlayerHeading = {
  show: null,
  logo: null,
  place: null,
  title: '',
  length: null,
}
