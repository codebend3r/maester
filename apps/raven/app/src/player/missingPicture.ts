import { PLAYBACK_MODES, type PlaybackMode } from '@raven/core'

import { type AppPlatform, PLATFORM_TRAITS } from '@/platform/platform'

/**
 * AVPlayer, given HEVC under the `hev1` tag in an MP4, plays its sound and never draws its
 * picture, reporting no error: the screen stays black while the clock runs. The index keeps no
 * tag, so the plan tries such a file as it is. A direct play on Apple that has run this many
 * seconds of its own clock without a picture counts as refused, and steps down to the remux,
 * which re-tags it `hvc1`.
 */
export const NO_PICTURE_SECONDS = 4

/** What one attempt has shown: whether a picture was drawn, and the clock its play started from. */
export type PictureWatch = { attempt: number; hasPicture: boolean; from: number | null }

export const PICTURE_HEARINGS = { drawn: 'drawn', moved: 'moved' } as const

/** The player drawing its first picture, or its clock moving on. */
export type PictureHearing =
  | { type: typeof PICTURE_HEARINGS.drawn; attempt: number }
  | { type: typeof PICTURE_HEARINGS.moved; attempt: number; clock: number }

type WatchPictureProps = {
  watch: PictureWatch | null
  hearing: PictureHearing
  platform: AppPlatform
  mode: PlaybackMode | null
}

type WatchedPicture = { watch: PictureWatch; isMissing: boolean }

/**
 * Hears the player for the attempt it plays and says when its picture is missing: a direct play
 * on Apple whose clock has run `NO_PICTURE_SECONDS` with no picture drawn. Each attempt is
 * watched afresh; a stream carries the picture the server made, and ExoPlayer reports what it
 * cannot decode, so neither is watched.
 */
export const watchPicture = ({
  watch,
  hearing,
  platform,
  mode,
}: WatchPictureProps): WatchedPicture => {
  const own: PictureWatch =
    watch !== null && watch.attempt === hearing.attempt
      ? watch
      : { attempt: hearing.attempt, hasPicture: false, from: null }
  if (hearing.type === PICTURE_HEARINGS.drawn) {
    return { watch: { ...own, hasPicture: true }, isMissing: false }
  }
  const from = own.from ?? hearing.clock
  const isWatched =
    PLATFORM_TRAITS[platform].shouldWatchMissingPicture && mode === PLAYBACK_MODES.direct
  return {
    watch: { ...own, from },
    isMissing: isWatched && !own.hasPicture && hearing.clock - from >= NO_PICTURE_SECONDS,
  }
}
