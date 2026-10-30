// app.config.ts reads these by relative path, so this module imports nothing.

/** The colours each theme gives its own value in themes.scss, by what Wren paints with them. */
export const PALETTE_TOKENS = {
  ground: '--color-night',
} as const
