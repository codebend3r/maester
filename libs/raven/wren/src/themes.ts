import { isRecord, oneOf } from '@raven/core'

/** The themes Wren wears, by the name the preferences keep and the page's `data-theme` says. */
export const WREN_THEMES = {
  night: 'night',
  paper: 'paper',
  garnet: 'garnet',
  blush: 'blush',
  mint: 'mint',
  dracula: 'dracula',
  midnight: 'midnight',
  banana: 'banana',
  ember: 'ember',
} as const

export type WrenThemeName = (typeof WREN_THEMES)[keyof typeof WREN_THEMES]

const isWrenThemeName = oneOf(Object.values(WREN_THEMES))

/** Whether a ground is dark or light: what the system reports, and what each theme is. */
export const COLOR_SCHEMES = { dark: 'dark', light: 'light' } as const

export type ColorScheme = (typeof COLOR_SCHEMES)[keyof typeof COLOR_SCHEMES]

const isColorScheme = oneOf(Object.values(COLOR_SCHEMES))

/** Each theme's scheme: how the system draws its own parts over it, and which ink the logo takes. */
export const THEME_SCHEMES = {
  [WREN_THEMES.night]: COLOR_SCHEMES.dark,
  [WREN_THEMES.paper]: COLOR_SCHEMES.light,
  [WREN_THEMES.garnet]: COLOR_SCHEMES.dark,
  [WREN_THEMES.blush]: COLOR_SCHEMES.light,
  [WREN_THEMES.mint]: COLOR_SCHEMES.light,
  [WREN_THEMES.dracula]: COLOR_SCHEMES.dark,
  [WREN_THEMES.midnight]: COLOR_SCHEMES.dark,
  [WREN_THEMES.banana]: COLOR_SCHEMES.light,
  [WREN_THEMES.ember]: COLOR_SCHEMES.dark,
} as const satisfies Record<WrenThemeName, ColorScheme>

/** How Wren picks its theme: one for each of the device's schemes, or one whatever the device says. */
export const THEME_MODES = { system: 'system', single: 'single' } as const

export type ThemeMode = (typeof THEME_MODES)[keyof typeof THEME_MODES]

const isThemeMode = oneOf(Object.values(THEME_MODES))

/** What Settings' Appearance keeps: the mode, the one theme, and the theme for each scheme. */
export type ThemeChoice = {
  themeMode: ThemeMode
  /** The theme worn in the `single` mode. */
  theme: WrenThemeName
  /** The theme worn in the `system` mode while the device is light. */
  lightTheme: WrenThemeName
  /** The theme worn in the `system` mode while the device is dark. */
  darkTheme: WrenThemeName
}

/** The preference that holds each scheme's theme. */
const SCHEME_KEYS = {
  [COLOR_SCHEMES.light]: 'lightTheme',
  [COLOR_SCHEMES.dark]: 'darkTheme',
} as const satisfies Record<ColorScheme, keyof ThemeChoice>

/** A first run: Paper while the device is light, Night while it is dark. */
export const DEFAULT_THEME_CHOICE: ThemeChoice = {
  themeMode: THEME_MODES.system,
  theme: WREN_THEMES.night,
  lightTheme: WREN_THEMES.paper,
  darkTheme: WREN_THEMES.night,
}

/**
 * The theme choice read back from what was kept, each part guarded on its own. What an older
 * Wren kept as `appearance` is read too: its Light and Dark become the one theme of that
 * scheme, and its System the default.
 */
export const themeChoiceOf = (saved: unknown): ThemeChoice => {
  const kept = isRecord(saved) ? saved : {}
  const themes = {
    theme: isWrenThemeName(kept.theme) ? kept.theme : DEFAULT_THEME_CHOICE.theme,
    lightTheme: isWrenThemeName(kept.lightTheme)
      ? kept.lightTheme
      : DEFAULT_THEME_CHOICE.lightTheme,
    darkTheme: isWrenThemeName(kept.darkTheme) ? kept.darkTheme : DEFAULT_THEME_CHOICE.darkTheme,
  }
  if (isThemeMode(kept.themeMode)) return { ...themes, themeMode: kept.themeMode }
  if (!isColorScheme(kept.appearance)) {
    return { ...themes, themeMode: DEFAULT_THEME_CHOICE.themeMode }
  }
  return {
    ...themes,
    themeMode: THEME_MODES.single,
    theme: DEFAULT_THEME_CHOICE[SCHEME_KEYS[kept.appearance]],
  }
}

/** The scheme a device reports, dark when it says neither. */
export const systemSchemeOf = (system: unknown): ColorScheme =>
  system === COLOR_SCHEMES.light ? COLOR_SCHEMES.light : COLOR_SCHEMES.dark

/** The theme choice alone, out of a store that keeps it among other preferences. */
export const themeChoiceIn = ({
  themeMode,
  theme,
  lightTheme,
  darkTheme,
}: ThemeChoice): ThemeChoice => ({ themeMode, theme, lightTheme, darkTheme })

type ThemeForProps = {
  choice: ThemeChoice
  /** The device's scheme now, or the slot of the two that Settings is picking. */
  scheme: ColorScheme
}

/**
 * The theme a choice keeps for a scheme: the one theme, or the scheme's own. Given the device's
 * scheme it is the theme Wren wears now; given a slot, the theme Settings shows as picked there.
 */
export const themeFor = ({ choice, scheme }: ThemeForProps): WrenThemeName =>
  choice.themeMode === THEME_MODES.single ? choice.theme : choice[SCHEME_KEYS[scheme]]

type WithThemePickedProps = ThemeForProps & { theme: WrenThemeName }

/** The preferences a pick can change: the one theme, or a scheme's own. */
type PickedThemes = Partial<Pick<ThemeChoice, 'theme' | (typeof SCHEME_KEYS)[ColorScheme]>>

/** What picking a theme changes: the one theme, or the scheme's own. */
export const withThemePicked = ({ choice, scheme, theme }: WithThemePickedProps): PickedThemes =>
  choice.themeMode === THEME_MODES.single ? { theme } : { [SCHEME_KEYS[scheme]]: theme }
