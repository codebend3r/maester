import { basename, join } from 'node:path'
import { CAPTION_COLOUR_VALUES, CAPTION_SIZE_SCALES, type CaptionStyle } from '@raven/core'
import { MPV_OPTIONS, type MpvOption } from '@raven/mpv'
import { FONTS } from '@/build/forgeOptions'

/** The family name inside `resources/fonts/YoungSerif.ttf`, which is what libass matches on. */
const SUBTITLE_FONT = 'Young Serif'

const SUBTITLE_OUTLINE = { colour: '#000000', size: 2 } as const

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
 * subtitles (PGS, VobSub) are images and stay as they are. The outline with no shadow and no
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
]

/** An account's look as mpv draws it: a multiple of its own subtitle size, and a `#rrggbb` colour. */
export const subtitleStyleOptions = ({ size, colour }: CaptionStyle): MpvOption[] => [
  { name: MPV_OPTIONS.subScale, value: CAPTION_SIZE_SCALES[size] },
  { name: MPV_OPTIONS.subColor, value: CAPTION_COLOUR_VALUES[colour] },
]
