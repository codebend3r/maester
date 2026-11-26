import { createWrenTheming } from '@raven/wren-native'
import { type ViewStyle, useWindowDimensions } from 'react-native'

import { useWrenPrefs } from '@/stores/wrenPrefs'
import { BREAKPOINTS, FORM_FACTORS, type FormFactor, type Shadow } from '@/theme/wrenTokens'

export type { WrenTheme } from '@raven/wren-native'

type ShadowOfProps = { shadow: Shadow; color: string }

/** A shadow from `SHADOWS` as React Native's style, in the theme's shadow colour. */
export const shadowOf = ({ shadow, color }: ShadowOfProps): ViewStyle => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: shadow.offsetY },
  shadowOpacity: 1,
  shadowRadius: shadow.radius,
  elevation: shadow.elevation,
})

/**
 * The device's scheme, the theme showing and `themedStyles`, every Wren's on React Native, over
 * the theme choice this app's own prefs keep.
 */
export const { useSystemScheme, useWrenTheme, themedStyles } = createWrenTheming({
  useThemeChoice: useWrenPrefs,
})

/** Whether the screen is a tablet's: its shortest side at least the tablet breakpoint. */
const useIsTablet = (): boolean => {
  const { width, height } = useWindowDimensions()
  return Math.min(width, height) >= BREAKPOINTS.tablet
}

/** The form factor of the screen showing; anything that differs by it is a map keyed by it. */
export const useFormFactor = (): FormFactor =>
  useIsTablet() ? FORM_FACTORS.tablet : FORM_FACTORS.phone

/** Whether a tablet is held upright, when its sidebar folds to a rail of icons. */
export const useIsPortrait = (): boolean => {
  const { width, height } = useWindowDimensions()
  return height > width
}
