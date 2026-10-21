// app.config.ts reads these too, by relative path, so this module imports nothing.

/** The colours each theme gives its own value in themes.scss, by what the screens paint with them. */
export const PALETTE_TOKENS = {
  ground: '--color-night',
  deep: '--color-deep',
  raised: '--color-canopy',
  line: '--color-moss-line',
  text: '--color-bark',
  muted: '--color-lichen',
  accent: '--color-leaf',
  onAccent: '--color-on-leaf',
  quiet: '--color-moss',
  notice: '--color-amber',
  error: '--color-leaf-bright',
  track: '--color-moss',
  played: '--color-leaf-bright',
} as const

/**
 * The colours every theme shares, from globals.scss: the player's one dark look over the
 * picture, as the web's, and whatever else sits on a picture.
 */
export const FIXED_TOKENS = {
  stage: '--color-stage',
  onPicture: '--color-on-picture',
  pictureGlass: '--color-picture-glass',
  pictureTrack: '--color-bark-faint',
} as const

/**
 * What the page's colours become over the video: the web player's own set (`Player.module.scss`,
 * its controls and its settings menu), from globals.scss and the same in every theme. A chip, a
 * plate, a list or a page drawn over the picture is dark glass with on-picture text whatever the
 * page wears; the played line and the rest stay the theme's, as the web's `--color-leaf-bright`.
 */
export const OVER_PICTURE_TOKENS = {
  ground: '--color-stage',
  deep: '--color-stage',
  raised: '--color-picture-glass',
  quiet: '--color-picture-glass',
  line: '--color-bark-faint',
  track: '--color-bark-faint',
  text: '--color-on-picture',
  muted: '--color-on-picture-soft',
} as const satisfies Partial<Record<keyof typeof PALETTE_TOKENS, string>>
