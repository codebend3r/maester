import { type DesignToken, TOKEN_GROUPS } from '@raven/ui'

/** The tokens in ui's `globals.scss` that get a sample of their own. */
const SAMPLED_TOKENS = {
  focusRing: '--focus-ring',
  borderThick: '--border-thick',
  maxWidth: '--max-width',
  measure: '--measure',
  fieldSize: '--field-size',
  trackingEyebrow: '--tracking-eyebrow',
  shadowText: '--shadow-text',
  glow: '--glow',
} as const

/** How a token is drawn at its true size beside its value. */
export const SAMPLES = {
  /** A bar as wide as the step. */
  bar: 'bar',
  /** A bar as wide as the measure, or as the row allows. */
  width: 'width',
  /** A box with the corners. */
  radius: 'radius',
  /** A line in the face. */
  family: 'family',
  /** A line at the size, in the display serif. */
  size: 'size',
  /** A paragraph set to the line height. */
  line: 'line',
  /** A title drawn in by the tracking. */
  tracking: 'tracking',
  /** An eyebrow opened up by it. */
  eyebrow: 'eyebrow',
  /** A square that moves along the curve while the row is pointed at. */
  ease: 'ease',
  /** A card lifted by the shadow. */
  shadow: 'shadow',
  /** A word lifted by it, as subtitles are. */
  textShadow: 'textShadow',
  /** A picture with the fade over it. */
  fade: 'fade',
  /** A colour wash as strong as the glow. */
  glow: 'glow',
  /** A control as tall as the size. */
  height: 'height',
  /** A dashed line as thick as the border. */
  border: 'border',
  /** Something focused, with the ring around it. */
  focus: 'focus',
  /** Nothing to draw. */
  none: 'none',
} as const

export type Sample = (typeof SAMPLES)[keyof typeof SAMPLES]

export type TokenRow = DesignToken & { sample: Sample }

type Group = {
  name: string
  has: (token: DesignToken) => boolean
  sample: (name: string) => Sample
}

/** Steps that are not --space-* but are spacing all the same. */
const SPACING = new Set(['--gutter', '--section-gap', '--titlebar-inset'])

const named =
  (...prefixes: readonly string[]) =>
  (token: DesignToken) =>
    prefixes.some((prefix) => token.name.startsWith(prefix))

const sizeSample = (name: string): Sample => {
  if (name === SAMPLED_TOKENS.focusRing) return SAMPLES.focus
  if (name === SAMPLED_TOKENS.borderThick) return SAMPLES.border
  if (name === SAMPLED_TOKENS.maxWidth || name === SAMPLED_TOKENS.measure) return SAMPLES.width
  if (name.startsWith('--control-size') || name === SAMPLED_TOKENS.fieldSize) return SAMPLES.height
  return SAMPLES.none
}

/**
 * The groups the tokens page shows, in order. A token joins the first group
 * that has it, so the last takes whatever no other group named.
 */
const GROUPS: readonly Group[] = [
  {
    name: 'Spacing',
    has: (token) => token.group === TOKEN_GROUPS.space || SPACING.has(token.name),
    sample: () => SAMPLES.bar,
  },
  {
    name: 'Radius',
    has: (token) => token.group === TOKEN_GROUPS.radius,
    sample: () => SAMPLES.radius,
  },
  {
    name: 'Typefaces',
    has: (token) => token.group === TOKEN_GROUPS.font,
    sample: () => SAMPLES.family,
  },
  {
    name: 'Type scale',
    has: (token) => token.group === TOKEN_GROUPS.fontSize,
    sample: () => SAMPLES.size,
  },
  {
    name: 'Line height',
    has: (token) => token.group === TOKEN_GROUPS.line,
    sample: () => SAMPLES.line,
  },
  { name: 'Radius', has: (token) => token.group === 'radius', sample: () => 'radius' },
  { name: 'Typefaces', has: (token) => token.group === 'font', sample: () => 'family' },
  { name: 'Type scale', has: (token) => token.group === 'font-size', sample: () => 'size' },
  { name: 'Line height', has: (token) => token.group === 'line', sample: () => 'line' },
  {
    name: 'Tracking',
    has: named('--tracking-'),
    sample: (name) =>
      name === SAMPLED_TOKENS.trackingEyebrow ? SAMPLES.eyebrow : SAMPLES.tracking,
  },
  { name: 'Easing', has: named('--ease-'), sample: () => SAMPLES.ease },
  {
    name: 'Shadows',
    has: named('--shadow-'),
    sample: (name) => (name === SAMPLED_TOKENS.shadowText ? SAMPLES.textShadow : SAMPLES.shadow),
  },
  {
    name: 'Fades and glow',
    has: named('--fade-', SAMPLED_TOKENS.glow),
    sample: (name) => (name === SAMPLED_TOKENS.glow ? SAMPLES.glow : SAMPLES.fade),
  },
  {
    name: 'Layout and focus',
    has: (token) => token.group !== TOKEN_GROUPS.colour,
    sample: sizeSample,
  },
  { name: 'Layout and focus', has: (token) => token.group !== 'colour', sample: sizeSample },
]

/** Every token but the colours, in the groups the tokens page shows, each with how it is drawn. */
export const groupTokens = (
  tokens: readonly DesignToken[],
): Array<{ name: string; rows: TokenRow[] }> => {
  const rows = tokens.reduce<TokenRow[][]>(
    (grouped, token) => {
      const index = GROUPS.findIndex((group) => group.has(token))
      const group = GROUPS[index]
      if (!group) return grouped
      return grouped.with(index, [
        ...(grouped[index] ?? []),
        { ...token, sample: group.sample(token.name) },
      ])
    },
    GROUPS.map(() => []),
  )
  return GROUPS.map((group, index) => ({ name: group.name, rows: rows[index] ?? [] })).filter(
    (group) => group.rows.length > 0,
  )
}
