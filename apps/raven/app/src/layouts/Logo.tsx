import { THEME_TONES, type ThemeTone } from '@raven/core'
import { Image, type ImageRequireSource } from 'react-native'

import markOnDark from '@/theme/brand/raven-mark-on-dark.png'
import markOnLight from '@/theme/brand/raven-mark-on-light.png'
import { useTheme } from '@/theme/useTheme'

/**
 * Each mark is drawn for its ground, as the web's are: bark on a dark one, the original ink
 * and red on a light one. They are the web's `public/brand` files, which a test keeps them to.
 */
export const LOGO_MARKS = {
  [THEME_TONES.dark]: markOnDark,
  [THEME_TONES.light]: markOnLight,
} as const satisfies Record<ThemeTone, ImageRequireSource>

/** The marks are 938 by 1024 pixels. */
const MARK_HEIGHT_PER_WIDTH = 1024 / 938

/** What the mark is called aloud: the app it stands for. */
const LOGO_NAME = 'raven'

type LogoProps = { width: number }

/** raven's mark, `width` points wide, drawn for the ground of the theme worn now. */
export const Logo = ({ width }: LogoProps) => {
  const tone = useTheme((theme) => theme.tone)
  return (
    <Image
      accessibilityLabel={LOGO_NAME}
      accessibilityRole="image"
      accessible
      resizeMode="contain"
      source={LOGO_MARKS[tone]}
      style={{ width, height: width * MARK_HEIGHT_PER_WIDTH }}
    />
  )
}
