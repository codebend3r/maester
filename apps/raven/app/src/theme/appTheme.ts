import { DEFAULT_THEME } from '@raven/core'
import { designTokens, themeTokens } from '@raven/ui/designTokens'

import { nativeTokens } from '@/theme/nativeTokens'

const { numbers, colours: fixedColours } = nativeTokens(
  Object.fromEntries(designTokens.map(({ name, value }) => [name, value])),
)
const { colours } = nativeTokens(themeTokens[DEFAULT_THEME] ?? {})

/**
 * The token `name` from `tokens`. One the stylesheets dropped or renamed fails the app as
 * it loads, and every render test with it, rather than painting the screen with nothing.
 */
const tokenOf = <T>({ tokens, name }: { tokens: Readonly<Record<string, T>>; name: string }): T => {
  const value = tokens[name]
  if (value === undefined) throw new Error(`raven's app has no design token ${name}`)
  return value
}

const colour = (name: string): string => tokenOf({ tokens: colours, name })
const size = (name: string): number => tokenOf({ tokens: numbers, name })
/** A colour every theme shares, as what sits on a picture does. */
const fixedColour = (name: string): string => tokenOf({ tokens: fixedColours, name })

/** The default theme's colours the screens paint with, by what they are for. */
export const COLOURS = {
  ground: colour('--color-night'),
  deep: colour('--color-deep'),
  raised: colour('--color-canopy'),
  line: colour('--color-moss-line'),
  text: colour('--color-bark'),
  muted: colour('--color-lichen'),
  accent: colour('--color-leaf'),
  onAccent: colour('--color-on-leaf'),
  quiet: colour('--color-moss'),
  notice: colour('--color-amber'),
  error: colour('--color-leaf-bright'),
  track: colour('--color-moss'),
  onPicture: fixedColour('--color-on-picture'),
} as const

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
