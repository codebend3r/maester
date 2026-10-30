import type { Track } from '@raven/core'

type MovedUpProps = { tracks: readonly Track[]; index: number }

/** `tracks` with the one at `index` a place higher; the very same list for the first. */
export const movedUp = ({ tracks, index }: MovedUpProps): readonly Track[] => {
  const moving = tracks[index]
  const above = tracks[index - 1]
  if (moving === undefined || above === undefined) return tracks
  return tracks.with(index - 1, moving).with(index, above)
}

type WithoutPlaceProps = { tracks: readonly Track[]; index: number }

/** `tracks` without the one at `index`, its other copies kept. */
export const withoutPlace = ({ tracks, index }: WithoutPlaceProps): readonly Track[] =>
  tracks.filter((_track, place) => place !== index)
