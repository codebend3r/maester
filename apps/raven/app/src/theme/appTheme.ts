import { DEFAULT_THEME, THEMES, type ThemeId, type ThemeTone, themeOf } from '@raven/core'
import { designTokens, themeTokens } from '@raven/ui/designTokens'

import { nativeTokens } from '@/theme/nativeTokens'
import { OVER_PICTURE_TOKENS, PALETTE_TOKENS } from '@/theme/tokenNames'

const { numbers, colours: rootColours } = nativeTokens(
  Object.fromEntries(designTokens.map(({ name, value }) => [name, value])),
)

type TokenOfProps<T> = { tokens: Readonly<Record<string, T>>; name: string }

/**
 * The token `name` from `tokens`. One the stylesheets dropped or renamed fails the app as
 * it loads, and every render test with it, rather than painting the screen with nothing.
 */
const tokenOf = <T>({ tokens, name }: TokenOfProps<T>): T => {
  const value = tokens[name]
  if (value === undefined) throw new Error(`raven's app has no design token ${name}`)
  return value
}

const size = (name: string): number => tokenOf({ tokens: numbers, name })

/** A colour globals.scss gives every theme alike. */
const fixed = (name: string): string => tokenOf({ tokens: rootColours, name })

export type Palette = Record<keyof typeof PALETTE_TOKENS, string>

/**
 * A theme as the app wears it: its colours, the ones it wears over the video, and whether its
 * ground is light or dark, which picks the logo drawn for it and how the system draws over it.
 */
export type AppTheme = { id: ThemeId; palette: Palette; overPicture: Palette; tone: ThemeTone }

/** A theme's colours, read from themes.scss through the built `themeTokens`, never copied. */
const paletteOf = (id: ThemeId): Palette => {
  const { colours } = nativeTokens(themeTokens[id] ?? {})
  const colour = (name: string): string => tokenOf({ tokens: colours, name })
  return {
    ground: colour(PALETTE_TOKENS.ground),
    deep: colour(PALETTE_TOKENS.deep),
    raised: colour(PALETTE_TOKENS.raised),
    line: colour(PALETTE_TOKENS.line),
    text: colour(PALETTE_TOKENS.text),
    muted: colour(PALETTE_TOKENS.muted),
    accent: colour(PALETTE_TOKENS.accent),
    onAccent: colour(PALETTE_TOKENS.onAccent),
    quiet: colour(PALETTE_TOKENS.quiet),
    notice: colour(PALETTE_TOKENS.notice),
    error: colour(PALETTE_TOKENS.error),
    track: colour(PALETTE_TOKENS.track),
    played: colour(PALETTE_TOKENS.played),
  }
}

/** `palette` over the video: the player's dark glass and on-picture text, the same in every theme. */
const overPictureOf = (palette: Palette): Palette => ({
  ...palette,
  ground: fixed(OVER_PICTURE_TOKENS.ground),
  deep: fixed(OVER_PICTURE_TOKENS.deep),
  raised: fixed(OVER_PICTURE_TOKENS.raised),
  quiet: fixed(OVER_PICTURE_TOKENS.quiet),
  line: fixed(OVER_PICTURE_TOKENS.line),
  track: fixed(OVER_PICTURE_TOKENS.track),
  text: fixed(OVER_PICTURE_TOKENS.text),
  muted: fixed(OVER_PICTURE_TOKENS.muted),
})

type AppThemeForProps = { id: ThemeId; tone: ThemeTone }

const appThemeFor = ({ id, tone }: AppThemeForProps): AppTheme => {
  const palette = paletteOf(id)
  return { id, palette, overPicture: overPictureOf(palette), tone }
}

/** Every theme the app can wear, made once as it loads, so each is the same object every time. */
export const APP_THEMES: readonly AppTheme[] = THEMES.map(appThemeFor)

// Every id has its theme above; this is what `find` falls back on to say so to the compiler.
const DEFAULT_APP_THEME: AppTheme =
  APP_THEMES.find(({ id }) => id === DEFAULT_THEME) ??
  appThemeFor({ id: DEFAULT_THEME, tone: themeOf(DEFAULT_THEME).tone })

/** The theme by its id, the same object for the same id. */
export const appThemeOf = (id: ThemeId): AppTheme =>
  APP_THEMES.find((theme) => theme.id === id) ?? DEFAULT_APP_THEME

/** The shared scale's lengths, in points, named as the web's custom properties are. */
export const SIZES = {
  space0: size('--space-0'),
  space1: size('--space-1'),
  space2: size('--space-2'),
  space3: size('--space-3'),
  space4: size('--space-4'),
  space5: size('--space-5'),
  space6: size('--space-6'),
  space8: size('--space-8'),
  radius: size('--radius-md'),
  textXs: size('--font-size-xs'),
  textSm: size('--font-size-sm'),
  text: size('--font-size-md'),
  textLg: size('--font-size-lg'),
  textXl: size('--font-size-xl'),
  measure: size('--measure'),
  fieldHeight: size('--field-size'),
  controlLarge: size('--control-size-large'),
  // The web's `--focus-ring` is `2px solid var(--color-bark)`, which React Native takes in parts.
  focusRing: size('--border-thick'),
  // The web's ring is read from a desk; from the sofa it is drawn twice as thick.
  tvFocusRing: size('--border-thick') * 2,
} as const

/** A set of the shared scale's lengths: `SIZES`, or the TV layouts' sized to the screen. */
export type Sizes = Record<keyof typeof SIZES, number>
