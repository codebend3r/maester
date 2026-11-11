import { type Infer, object, oneOf } from '@/schema'

/** How large the subtitles are drawn, smallest first. */
export const CAPTION_SIZES = {
  small: 'small',
  medium: 'medium',
  large: 'large',
  largest: 'largest',
} as const

export type CaptionSize = (typeof CAPTION_SIZES)[keyof typeof CAPTION_SIZES]

/** The colours the subtitles can be drawn in. */
export const CAPTION_COLOURS = {
  white: 'white',
  yellow: 'yellow',
  cyan: 'cyan',
  green: 'green',
} as const

export type CaptionColour = (typeof CAPTION_COLOURS)[keyof typeof CAPTION_COLOURS]

/** Where an account's subtitle look is read and kept. */
export const CAPTION_PATHS = { style: '/api/caption-style' } as const

/**
 * `GET` and `PUT` on `CAPTION_PATHS.style`: how an account's subtitles look, the same for every video
 * on every device it signs in on. The face is always the display face; only these two vary.
 */
export const isCaptionStyle = object({
  size: oneOf(Object.values(CAPTION_SIZES)),
  colour: oneOf(Object.values(CAPTION_COLOURS)),
})

export type CaptionStyle = Infer<typeof isCaptionStyle>

/** The look an account has until it picks one. */
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  size: CAPTION_SIZES.medium,
  colour: CAPTION_COLOURS.white,
}

/** What each size multiplies a player's own subtitle size by. */
export const CAPTION_SIZE_SCALES = {
  [CAPTION_SIZES.small]: 0.8,
  [CAPTION_SIZES.medium]: 1,
  [CAPTION_SIZES.large]: 1.3,
  [CAPTION_SIZES.largest]: 1.6,
} as const satisfies Record<CaptionSize, number>

/** Each colour as `#rrggbb`, bright enough to read over any picture behind a dark edge. */
export const CAPTION_COLOUR_VALUES = {
  [CAPTION_COLOURS.white]: '#ffffff',
  [CAPTION_COLOURS.yellow]: '#ffe14d',
  [CAPTION_COLOURS.cyan]: '#6fe8ff',
  [CAPTION_COLOURS.green]: '#7dff8a',
} as const satisfies Record<CaptionColour, string>
