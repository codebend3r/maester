import {
  type ImageStyle,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
  useColorScheme,
  useWindowDimensions,
} from 'react-native'

import { APPEARANCES, type Appearance, useWrenPrefs } from '@/stores/wrenPrefs'
import {
  BREAKPOINTS,
  COLOR_SCHEMES,
  COLORS,
  type ColorScheme,
  FORM_FACTORS,
  type FormFactor,
  type Palette,
} from '@/theme/wrenTokens'

/** What a screen paints with: the scheme picked and its palette. */
export type WrenTheme = { scheme: ColorScheme; colors: Palette }

const THEMES = {
  [COLOR_SCHEMES.dark]: { scheme: COLOR_SCHEMES.dark, colors: COLORS.dark },
  [COLOR_SCHEMES.light]: { scheme: COLOR_SCHEMES.light, colors: COLORS.light },
} as const satisfies Record<ColorScheme, WrenTheme>

type SchemeOfProps = { appearance: Appearance; system: string | null | undefined }

/** The scheme an appearance picks: the system's (dark when it says neither), or the one kept. */
const schemeOf = ({ appearance, system }: SchemeOfProps): ColorScheme => {
  if (appearance !== APPEARANCES.system) return appearance
  return system === COLOR_SCHEMES.light ? COLOR_SCHEMES.light : COLOR_SCHEMES.dark
}

/** The scheme Wren draws in now, following Settings' Appearance and the system. */
export const useColorSchemeOf = (): ColorScheme => {
  const appearance = useWrenPrefs((state) => state.appearance)
  const system = useColorScheme()
  return schemeOf({ appearance, system })
}

/** The theme Wren draws in now. */
export const useWrenTheme = (): WrenTheme => THEMES[useColorSchemeOf()]

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>

/**
 * A component's styles for both schemes, made once each when the module loads: the hook it
 * returns hands back the sheet for the scheme showing, so a component re-renders with the other
 * when the appearance changes and nothing is rebuilt.
 */
export const themedStyles = <S extends NamedStyles>(factory: (theme: WrenTheme) => S) => {
  const sheets = {
    [COLOR_SCHEMES.dark]: StyleSheet.create(factory(THEMES.dark)),
    [COLOR_SCHEMES.light]: StyleSheet.create(factory(THEMES.light)),
  } as const satisfies Record<ColorScheme, Readonly<S>>
  return (): Readonly<S> => sheets[useColorSchemeOf()]
}

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
