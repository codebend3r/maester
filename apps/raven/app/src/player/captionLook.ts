import { CAPTION_COLOUR_VALUES, CAPTION_SIZE_SCALES, type CaptionStyle } from '@raven/core'

import type { VideoSurface } from '@/layouts/playerKit'
import { DISPLAY_FONT } from '@/theme/fonts'
import { TV_SIZES } from '@/theme/tvSizes'

/**
 * The size a medium subtitle stands at on a TV, whoever draws it: read from the sofa, so a
 * step above the page's large type.
 */
export const TV_CAPTION_BASE = TV_SIZES.textXl

type CaptionSizeOfProps = {
  /** The size a medium caption stands at on this screen. */
  base: number
  style: CaptionStyle
}

/** How large the account's subtitles stand on a screen whose medium is `base`. */
export const captionSizeOf = ({ base, style }: CaptionSizeOfProps): number =>
  Math.round(base * CAPTION_SIZE_SCALES[style.size])

/**
 * The account's subtitle look as the player draws it where the player draws the subtitles
 * (Android TV's ExoPlayer): the display face in the account's colour and size, the same for
 * every track, whatever styles its file carries.
 */
export const playerSubtitleStyleOf = (
  style: CaptionStyle,
): NonNullable<VideoSurface['subtitleStyle']> => ({
  fontSize: captionSizeOf({ base: TV_CAPTION_BASE, style }),
  color: CAPTION_COLOUR_VALUES[style.colour],
  fontFamily: DISPLAY_FONT,
})
