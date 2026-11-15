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

/**
 * The fills of the picture's chips, from globals.scss and the same in every theme, as the web's
 * `ResolutionChip` wears them: each resolution tier its own, HEVC sky, any high range rose, Dolby
 * Vision profile 5 a warning's orange, all with the same dark ink. SD and any other codec stay
 * on the theme's raised ground.
 */
export const CHIP_TOKENS = {
  ink: '--color-resolution-ink',
  p320: '--color-resolution-320',
  p480: '--color-resolution-480',
  p720: '--color-resolution-720',
  p1080: '--color-resolution-1080',
  uhd: '--color-resolution-4k',
  uhd8k: '--color-resolution-8k',
  hevc: '--color-codec-hevc',
  hdr: '--color-range-hdr',
  dolbyVisionOnly: '--color-range-dv5',
  dolbyVisionDualLayer: '--color-range-dv7',
} as const

/** Each rating source's colour, from globals.scss and the same in every theme, as the web's ratings panel wears them. */
export const RATING_TOKENS = {
  rottenTomatoes: '--color-brand-rotten-tomatoes',
  imdb: '--color-brand-imdb',
  metacritic: '--color-brand-metacritic',
  tmdb: '--color-brand-tmdb-line',
} as const
