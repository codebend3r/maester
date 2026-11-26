import { basename, join } from 'node:path'
import {
  CAPTION_COLOUR_VALUES,
  CAPTION_FLOOR_SHARE,
  CAPTION_SIZE_SCALES,
  type CaptionStyle,
} from '@raven/core'
import { MPV_OPTIONS, type MpvOption } from '@raven/mpv'
import { FONTS } from '@/build/forgeOptions'

/** The family name inside `resources/fonts/YoungSerif.ttf`, which is what libass matches on. */
const SUBTITLE_FONT = 'Young Serif'

const SUBTITLE_OUTLINE = { colour: '#000000', size: 2 } as const

/**
 * Where mpv stands the subtitles, as a percentage of the frame's height: 100 is where the file
 * or the disc puts them, which can be the frame's last rows, and each point under it raises a
 * bottom line by a hundredth of the height, so core's floor is always clear under the last line.
 */
const SUBTITLE_POSITION = 100 - CAPTION_FLOOR_SHARE * 100

const ASS_OVERRIDES = { force: 'force' } as const

const BORDER_STYLES = { outlineAndShadow: 'outline-and-shadow' } as const

type FontsDirForProps = { isPackaged: boolean; appPath: string; resourcesPath: string }

/**
 * The folder holding raven's subtitle face: Forge copies it into the app's resources under
 * its own name, and unpackaged it is read from this project's folder.
 */
export const fontsDirFor = ({ isPackaged, appPath, resourcesPath }: FontsDirForProps): string =>
  isPackaged ? join(resourcesPath, basename(FONTS)) : join(appPath, FONTS)

type SubtitleLookOptionsProps = { fontsDir: string }

/**
 * Raven's one look for text subtitles, set as a video engine opens and before any load, since
 * libass reads the fonts folder when a track is made. `force` restyles ASS and SSA dialogue
 * with the same face, size, colour and outline while keeping each line's position; picture
 * subtitles (PGS, VobSub) are images and keep their look. `sub-pos` raises both kinds off the
 * frame's bottom edge. The outline with no shadow and no
 * box keeps the text readable over any picture.
 */
export const subtitleLookOptions = ({ fontsDir }: SubtitleLookOptionsProps): MpvOption[] => [
  { name: MPV_OPTIONS.subFontsDir, value: fontsDir },
  { name: MPV_OPTIONS.subFont, value: SUBTITLE_FONT },
  { name: MPV_OPTIONS.subAssOverride, value: ASS_OVERRIDES.force },
  { name: MPV_OPTIONS.subBorderStyle, value: BORDER_STYLES.outlineAndShadow },
  { name: MPV_OPTIONS.subOutlineColor, value: SUBTITLE_OUTLINE.colour },
  { name: MPV_OPTIONS.subOutlineSize, value: SUBTITLE_OUTLINE.size },
  { name: MPV_OPTIONS.subShadowOffset, value: 0 },
  { name: MPV_OPTIONS.subPos, value: SUBTITLE_POSITION },
]

/** A device's look as mpv draws it: a multiple of its own subtitle size, and a `#rrggbb` colour. */
export const subtitleStyleOptions = ({ size, colour }: CaptionStyle): MpvOption[] => [
  { name: MPV_OPTIONS.subScale, value: CAPTION_SIZE_SCALES[size] },
  { name: MPV_OPTIONS.subColor, value: CAPTION_COLOUR_VALUES[colour] },
]
