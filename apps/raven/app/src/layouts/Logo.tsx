import { THEME_TONES, type ThemeTone } from '@raven/core'
import Svg, { Circle, Path } from 'react-native-svg'

import type { AppTheme } from '@/theme/appTheme'
import { RAVEN_MARK } from '@/theme/brand/ravenMark'
import { useTheme } from '@/theme/useTheme'

/** How the mark may be drawn: the brand's own ink with its red eye, the theme's leaf, or one colour. */
const LOGO_LOOKS = { inked: 'inked', leaf: 'leaf', mono: 'mono' } as const

export type LogoLook = (typeof LOGO_LOOKS)[keyof typeof LOGO_LOOKS]

const LOOKS = Object.values(LOGO_LOOKS)

/**
 * The look this launch wears, picked once as the app starts, so the mark is the same on every
 * screen of a run and another the next time: a little variety without a flicker.
 */
const pickLook = (): LogoLook => LOOKS[Math.floor(Math.random() * LOOKS.length)] ?? LOGO_LOOKS.inked

/** The look this launch wears. */
export const LAUNCH_LOOK = pickLook()

/** The mark's body on each ground, as the web's two files draw it. */
const INK_BY_TONE = {
  [THEME_TONES.dark]: RAVEN_MARK.colours.onDark,
  [THEME_TONES.light]: RAVEN_MARK.colours.onLight,
} as const satisfies Record<ThemeTone, string>

type LogoColoursOfProps = { look: LogoLook; theme: AppTheme }

/** What the mark's body and eye are painted with, in `look`, for `theme`. */
export const logoColoursOf = ({
  look,
  theme,
}: LogoColoursOfProps): { body: string; eye: string } => {
  switch (look) {
    case LOGO_LOOKS.inked:
      return { body: INK_BY_TONE[theme.tone], eye: RAVEN_MARK.colours.eye }
    case LOGO_LOOKS.leaf:
      return { body: theme.palette.accent, eye: RAVEN_MARK.colours.eye }
    case LOGO_LOOKS.mono:
      return { body: theme.palette.text, eye: theme.palette.text }
    default: {
      const unknown: never = look
      return unknown
    }
  }
}

/** The marks are 646 by 705 units. */
const MARK_HEIGHT_PER_WIDTH = RAVEN_MARK.height / RAVEN_MARK.width

/** What the mark is called aloud: the app it stands for. */
const LOGO_NAME = 'raven'

/** How a test finds the mark's body, to read what it is painted with. */
export const LOGO_TEST_IDS = { body: 'raven-mark-body' } as const

type LogoProps = {
  width: number
  look?: LogoLook
  /** Drawn on the player's dark stage: the ink for a dark ground and the on-picture colours, whatever the theme. */
  isOverPicture?: boolean
}

/**
 * raven's mark, `width` points wide, drawn as vector art for the theme worn now: its ink for the
 * ground's tone with its red eye, the theme's leaf with the eye, or the text colour alone.
 */
export const Logo = ({ width, look = LAUNCH_LOOK, isOverPicture = false }: LogoProps) => {
  const worn = useTheme((each) => each)
  const theme = isOverPicture
    ? { ...worn, tone: THEME_TONES.dark, palette: worn.overPicture }
    : worn
  const { body, eye } = logoColoursOf({ look, theme })
  return (
    <Svg
      accessibilityLabel={LOGO_NAME}
      accessibilityRole="image"
      accessible
      height={width * MARK_HEIGHT_PER_WIDTH}
      viewBox={RAVEN_MARK.viewBox}
      width={width}
    >
      <Path d={RAVEN_MARK.body} fill={body} testID={LOGO_TEST_IDS.body} />
      <Circle cx={RAVEN_MARK.eye.cx} cy={RAVEN_MARK.eye.cy} fill={eye} r={RAVEN_MARK.eye.r} />
    </Svg>
  )
}
