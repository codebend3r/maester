import type { DesignToken } from '@raven/ui'

/** How a token is drawn at its true size beside its value. */
export type Sample =
  /** A bar as wide as the step. */
  | 'bar'
  /** A bar as wide as the measure, or as the row allows. */
  | 'width'
  /** A box with the corners. */
  | 'radius'
  /** A line in the face. */
  | 'family'
  /** A line at the size, in the display serif. */
  | 'size'
  /** A paragraph set to the line height. */
  | 'line'
  /** A title drawn in by the tracking. */
  | 'tracking'
  /** An eyebrow opened up by it. */
  | 'eyebrow'
  /** A square that moves along the curve while the row is pointed at. */
  | 'ease'
  /** A card lifted by the shadow. */
  | 'shadow'
  /** A word lifted by it, as subtitles are. */
  | 'textShadow'
  /** A picture with the fade over it. */
  | 'fade'
  /** A colour wash as strong as the glow. */
  | 'glow'
  /** A control as tall as the size. */
  | 'height'
  /** A dashed line as thick as the border. */
  | 'border'
  /** Something focused, with the ring around it. */
  | 'focus'
  /** Nothing to draw. */
  | 'none'

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
  if (name === '--focus-ring') return 'focus'
  if (name === '--border-thick') return 'border'
  if (name === '--max-width' || name === '--measure') return 'width'
  if (name.startsWith('--control-size') || name === '--field-size') return 'height'
  return 'none'
}

/**
 * The groups the tokens page shows, in order. A token joins the first group
 * that has it, so the last takes whatever no other group named.
 */
const GROUPS: readonly Group[] = [
  {
    name: 'Spacing',
    has: (token) => token.group === 'space' || SPACING.has(token.name),
    sample: () => 'bar',
  },
  { name: 'Radius', has: (token) => token.group === 'radius', sample: () => 'radius' },
  { name: 'Typefaces', has: (token) => token.group === 'font', sample: () => 'family' },
  { name: 'Type scale', has: (token) => token.group === 'font-size', sample: () => 'size' },
  { name: 'Line height', has: (token) => token.group === 'line', sample: () => 'line' },
  {
    name: 'Tracking',
    has: named('--tracking-'),
    sample: (name) => (name === '--tracking-eyebrow' ? 'eyebrow' : 'tracking'),
  },
  { name: 'Easing', has: named('--ease-'), sample: () => 'ease' },
  {
    name: 'Shadows',
    has: named('--shadow-'),
    sample: (name) => (name === '--shadow-text' ? 'textShadow' : 'shadow'),
  },
  {
    name: 'Fades and glow',
    has: named('--fade-', '--glow'),
    sample: (name) => (name === '--glow' ? 'glow' : 'fade'),
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
