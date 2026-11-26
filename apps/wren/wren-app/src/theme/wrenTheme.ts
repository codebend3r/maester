import {
  type ColorScheme,
  THEME_SCHEMES,
  WREN_THEMES,
  type WrenThemeName,
  systemSchemeOf,
  themeFor,
  WREN_PALETTES,
  type Palette,
} from '@raven/wren'
import {
  type ImageStyle,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
  useColorScheme,
  useWindowDimensions,
} from 'react-native'

import { useWrenPrefs } from '@/stores/wrenPrefs'
import { BREAKPOINTS, FORM_FACTORS, type FormFactor, type Shadow } from '@/theme/wrenTokens'

type ShadowOfProps = { shadow: Shadow; color: string }

/** A shadow from `SHADOWS` as React Native's style, in the theme's shadow colour. */
export const shadowOf = ({ shadow, color }: ShadowOfProps): ViewStyle => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: shadow.offsetY },
  shadowOpacity: 1,
  shadowRadius: shadow.radius,
  elevation: shadow.elevation,
})

/** What a screen paints with: the theme showing, its scheme and its palette. */
export type WrenTheme = { name: WrenThemeName; scheme: ColorScheme; colors: Palette }

/** Every theme's palette by its name, so a theme `@raven/wren` names and the tokens lack is a compile error. */
export const PALETTES = WREN_PALETTES satisfies Record<WrenThemeName, Palette>

const themeOf = (name: WrenThemeName): WrenTheme => ({
  name,
  scheme: THEME_SCHEMES[name],
  colors: PALETTES[name],
})

const THEMES = {
  [WREN_THEMES.night]: themeOf(WREN_THEMES.night),
  [WREN_THEMES.paper]: themeOf(WREN_THEMES.paper),
  [WREN_THEMES.garnet]: themeOf(WREN_THEMES.garnet),
  [WREN_THEMES.blush]: themeOf(WREN_THEMES.blush),
  [WREN_THEMES.mint]: themeOf(WREN_THEMES.mint),
  [WREN_THEMES.dracula]: themeOf(WREN_THEMES.dracula),
  [WREN_THEMES.midnight]: themeOf(WREN_THEMES.midnight),
  [WREN_THEMES.banana]: themeOf(WREN_THEMES.banana),
  [WREN_THEMES.ember]: themeOf(WREN_THEMES.ember),
} as const satisfies Record<WrenThemeName, WrenTheme>

/** The device's scheme now, followed as it changes: which of Settings' two slots is showing. */
export const useSystemScheme = (): ColorScheme => systemSchemeOf(useColorScheme())

/** The name of the theme Wren draws in now, following Settings' Appearance and the device. */
const useThemeName = (): WrenThemeName => {
  const scheme = useSystemScheme()
  return useWrenPrefs((choice) => themeFor({ choice, scheme }))
}

/** The theme Wren draws in now. */
export const useWrenTheme = (): WrenTheme => THEMES[useThemeName()]

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>

/**
 * A component's styles for every theme, each made the first time its theme shows and kept: the
 * hook it returns hands back the sheet for the theme showing, so a component re-renders with
 * another when the theme changes and nothing is rebuilt.
 */
export const themedStyles = <S extends NamedStyles>(factory: (theme: WrenTheme) => S) => {
  const sheets = new Map<WrenThemeName, Readonly<S>>()
  const sheetOf = (name: WrenThemeName): Readonly<S> => {
    const kept = sheets.get(name)
    if (kept !== undefined) return kept
    const made = StyleSheet.create(factory(THEMES[name]))
    sheets.set(name, made)
    return made
  }
  return (): Readonly<S> => sheetOf(useThemeName())
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
