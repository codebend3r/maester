import { Text as NativeText, type TextProps } from 'react-native'

import { BODY_FONT, DISPLAY_FONT } from '@/theme/fonts'

/**
 * React Native's `Text` in the web's fonts: the body font, and the display font for a heading,
 * as the web sets its titles. The display face has one weight, so a heading never asks for bold.
 */
export const Text = ({ style, accessibilityRole, ...props }: TextProps) => {
  const isHeading = accessibilityRole === 'header'
  return (
    <NativeText
      accessibilityRole={accessibilityRole}
      style={[
        { fontFamily: isHeading ? DISPLAY_FONT : BODY_FONT },
        style,
        isHeading && { fontWeight: 'normal' },
      ]}
      {...props}
    />
  )
}
