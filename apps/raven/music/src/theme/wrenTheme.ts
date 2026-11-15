import { DEFAULT_THEME } from '@raven/core'
import { tokenReaderOf } from '@raven/native/headless'
import { designTokenValues, themeTokens } from '@raven/ui/designTokens'

import { PALETTE_TOKENS, SHADE_TOKENS, SIZE_TOKENS } from '@/theme/tokenNames'

const READER = 'Wren'

const { colour } = tokenReaderOf({ tokens: themeTokens[DEFAULT_THEME] ?? {}, owner: READER })

const shared = tokenReaderOf({ tokens: designTokenValues, owner: READER })

const { size } = shared

/** Wren wears raven's default theme, read from themes.scss through the built tokens. */
export const PALETTE = {
  ground: colour(PALETTE_TOKENS.ground),
  raised: colour(PALETTE_TOKENS.raised),
  quiet: colour(PALETTE_TOKENS.quiet),
  line: colour(PALETTE_TOKENS.line),
  text: colour(PALETTE_TOKENS.text),
  muted: colour(PALETTE_TOKENS.muted),
  accent: colour(PALETTE_TOKENS.accent),
  onAccent: colour(PALETTE_TOKENS.onAccent),
  error: colour(PALETTE_TOKENS.error),
  notice: colour(PALETTE_TOKENS.notice),
} as const satisfies Record<keyof typeof PALETTE_TOKENS, string>

/** What Wren lays over a screen to hold a sheet above it, the same in every theme. */
export const SHADES = {
  scrim: shared.colour(SHADE_TOKENS.scrim),
} as const satisfies Record<keyof typeof SHADE_TOKENS, string>

/** raven's scale in points, from globals.scss. */
export const SIZES = {
  space1: size(SIZE_TOKENS.space1),
  space2: size(SIZE_TOKENS.space2),
  space3: size(SIZE_TOKENS.space3),
  space4: size(SIZE_TOKENS.space4),
  space5: size(SIZE_TOKENS.space5),
  radius: size(SIZE_TOKENS.radius),
  textSm: size(SIZE_TOKENS.textSm),
  text: size(SIZE_TOKENS.text),
  textLg: size(SIZE_TOKENS.textLg),
  textXl: size(SIZE_TOKENS.textXl),
  measure: size(SIZE_TOKENS.measure),
  fieldHeight: size(SIZE_TOKENS.fieldHeight),
} as const satisfies Record<keyof typeof SIZE_TOKENS, number>

/** How faint a control is drawn while a finger holds it, and while it is turned off. */
export const OPACITIES = { pressed: 0.6, disabled: 0.5 } as const
