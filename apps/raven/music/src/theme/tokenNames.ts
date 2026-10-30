// app.config.ts reads these by relative path, so this module imports nothing.

/** The colours each theme gives its own value in themes.scss, by what Wren paints with them. */
export const PALETTE_TOKENS = {
  ground: '--color-night',
  raised: '--color-canopy',
  quiet: '--color-moss',
  line: '--color-moss-line',
  text: '--color-bark',
  muted: '--color-lichen',
  accent: '--color-leaf',
  onAccent: '--color-on-leaf',
  error: '--color-leaf-bright',
  notice: '--color-amber',
} as const

/** The lengths globals.scss gives every theme alike, by what Wren sizes with them. */
export const SIZE_TOKENS = {
  space1: '--space-1',
  space2: '--space-2',
  space3: '--space-3',
  space4: '--space-4',
  space5: '--space-5',
  radius: '--radius-md',
  textSm: '--font-size-sm',
  text: '--font-size-md',
  textLg: '--font-size-lg',
  textXl: '--font-size-xl',
  measure: '--measure',
  fieldHeight: '--field-size',
  ring: '--border-thick',
} as const
