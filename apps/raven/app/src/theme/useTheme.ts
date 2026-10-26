import { useAppPrefs } from '@/stores/appPrefs'
import { APP_THEMES, type AppTheme, type Palette, appThemeOf } from '@/theme/appTheme'

/**
 * The theme this device wears, read through `selector`: Settings' pick in `useAppPrefs`, so a
 * new pick repaints every screen at once. Each theme is one object for good, so a selector that
 * answers its palette or tone re-renders only when the theme changes.
 */
export const useTheme = <T>(selector: (theme: AppTheme) => T): T =>
  useAppPrefs((prefs) => selector(appThemeOf(prefs.theme)))

/** Where a layout is drawn: on the page, in the theme's colours, or over the video. */
type Ground = {
  /** Over the video: the player's dark glass and on-picture text, the same in every theme. */
  isOverPicture?: boolean
}

/**
 * A layout's styles made once for every theme, on the page and over the video, as the module
 * loads, and the hook that hands back the set for the theme worn now (`isOverPicture` for a part
 * drawn over the video, as the web's player keeps one dark look). `build` reads its colours from
 * the palette it is given, never from a constant, so no style is left in another theme's colours.
 */
export const themedStyles = <T>(build: (palette: Palette) => T): ((ground?: Ground) => T) => {
  const sheets = new Map(
    APP_THEMES.flatMap((theme) =>
      [theme.palette, theme.overPicture].map((palette) => [palette, build(palette)] as const),
    ),
  )
  const useThemedStyles = ({ isOverPicture = false }: Ground = {}): T => {
    const palette = useTheme((theme) => (isOverPicture ? theme.overPicture : theme.palette))
    return sheets.get(palette) ?? build(palette)
  }
  return useThemedStyles
}

const OVER_PICTURE: Ground = { isOverPicture: true }

/**
 * `themedStyles` for what is only ever drawn over the video (the player's chrome, its captions,
 * the TV's notice in its place): the hook hands back the set built from the `overPicture`
 * palette, so its ground, text, glass and track are the web player's in every theme.
 */
export const pictureStyles = <T>(build: (palette: Palette) => T): (() => T) => {
  const useThemedStyles = themedStyles(build)
  const usePictureStyles = (): T => useThemedStyles(OVER_PICTURE)
  return usePictureStyles
}

/** The theme worn now, for code that runs outside a render, as a press does. */
export const themeNow = (): AppTheme => appThemeOf(useAppPrefs.getState().theme)

type FollowThemeProps = { apply: (theme: AppTheme) => void }

/**
 * Hands the theme worn now to `apply`, then each one picked after it, for what React does not
 * draw: the system's own light or dark look. Returns the way to stop.
 */
export const followTheme = ({ apply }: FollowThemeProps): (() => void) => {
  apply(themeNow())
  return useAppPrefs.subscribe((prefs, previous) => {
    if (prefs.theme !== previous.theme) apply(appThemeOf(prefs.theme))
  })
}
