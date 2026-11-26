import {
  type ColorScheme,
  type Palette,
  THEME_SCHEMES,
  WREN_PALETTES,
  WREN_THEMES,
  type WrenThemeName,
  systemSchemeOf,
  themeFor,
} from '@raven/wren'
import {
  type ImageStyle,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
  useColorScheme,
} from 'react-native'

import { useWrenPrefs } from '@/stores/wrenPrefs'

/** What a screen paints with: the theme showing, its scheme and its palette. */
export type WrenTheme = { name: WrenThemeName; scheme: ColorScheme; colors: Palette }

const themeOf = (name: WrenThemeName): WrenTheme => ({
  name,
  scheme: THEME_SCHEMES[name],
  colors: WREN_PALETTES[name],
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

/** The TV's scheme now, followed as it changes: which of Settings' two slots is showing. */
export const useSystemScheme = (): ColorScheme => systemSchemeOf(useColorScheme())

/** The name of the theme Wren draws in now, following Settings' Appearance and the TV. */
const useThemeName = (): WrenThemeName => {
  const scheme = useSystemScheme()
  return useWrenPrefs((choice) => themeFor({ choice, scheme }))
}

/** The theme Wren draws in now. */
export const useWrenTheme = (): WrenTheme => THEMES[useThemeName()]

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>

/**
 * A component's styles for every theme, each made the first time its theme shows and kept: the
 * hook it returns hands back the sheet for the theme showing.
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
