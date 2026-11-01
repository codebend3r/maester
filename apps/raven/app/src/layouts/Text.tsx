import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native'

import { BODY_FONT, DISPLAY_FONT } from '@/theme/fonts'

export const TEXT_VARIANTS = {
  body: 'body',
  display: 'display',
} as const

type TextVariant = (typeof TEXT_VARIANTS)[keyof typeof TEXT_VARIANTS]

const VARIANT_STYLES = {
  [TEXT_VARIANTS.body]: { fontFamily: BODY_FONT },
  [TEXT_VARIANTS.display]: { fontFamily: DISPLAY_FONT },
} as const satisfies Record<TextVariant, { fontFamily: string }>

// Young Serif has one weight: a bold or semibold style would make the system synthesize a
// smeared bold, so display text is forced to normal after the caller's style.
const DISPLAY_WEIGHT = { fontWeight: 'normal' } as const

type TextProps = NativeTextProps & { variant?: TextVariant }

/**
 * React Native's `Text` in the web's body face, Instrument Sans. Headings and titles opt into
 * the display face, Young Serif, with `variant={TEXT_VARIANTS.display}`, as the web sets only
 * its headings and titles in `--font-display`. Never set a block of running text in it.
 */
export const Text = ({ style, variant = TEXT_VARIANTS.body, ...props }: TextProps) => (
  <NativeText
    style={[VARIANT_STYLES[variant], style, variant === TEXT_VARIANTS.display && DISPLAY_WEIGHT]}
    {...props}
  />
)
