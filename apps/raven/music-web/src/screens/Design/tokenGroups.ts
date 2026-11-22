import { type DesignToken, TOKEN_GROUPS, type TokenGroup } from '@raven/core'
import { DESIGN_COPY } from '@raven/wren'

const NAMES = DESIGN_COPY.tokens.groups

/** How a token is drawn at its true size beside its value. */
export const SAMPLES = {
  /** A bar as wide as the step. */
  bar: 'bar',
  /** A box with the corners. */
  radius: 'radius',
  /** A line in the face. */
  family: 'family',
  /** A line at the weight. */
  weight: 'weight',
  /** A line at the size. */
  size: 'size',
  /** A paragraph set to the line height. */
  line: 'line',
  /** A word opened up or drawn in by the tracking. */
  tracking: 'tracking',
  /** A card lifted by the shadow. */
  shadow: 'shadow',
  /** Nothing to draw: the value says it. */
  none: 'none',
} as const

export type Sample = (typeof SAMPLES)[keyof typeof SAMPLES]

/** The name prefixes the groups read where `TOKEN_GROUPS` has no group of its own. */
const TOKEN_PREFIXES = {
  weight: '--font-weight-',
  tracking: '--tracking-',
  size: '--size-',
  shadow: '--shadow-',
  ease: '--ease-',
  duration: '--duration-',
  opacity: '--opacity-',
  type: '--type-',
} as const

type TokenPrefix = (typeof TOKEN_PREFIXES)[keyof typeof TOKEN_PREFIXES]

type TokenRow = DesignToken & { sample: Sample }

type Has = (token: DesignToken) => boolean

type Group = {
  name: string
  has: Has
  sample: Sample
}

const named =
  (...prefixes: readonly TokenPrefix[]): Has =>
  (token) =>
    prefixes.some((prefix) => token.name.startsWith(prefix))

const inGroup =
  (group: TokenGroup): Has =>
  (token) =>
    token.group === group

/** A token joins the first group that has it, so the last takes what no other named. */
const GROUPS: readonly Group[] = [
  { name: NAMES.spacing, has: inGroup(TOKEN_GROUPS.space), sample: SAMPLES.bar },
  { name: NAMES.radius, has: inGroup(TOKEN_GROUPS.radius), sample: SAMPLES.radius },
  { name: NAMES.weights, has: named(TOKEN_PREFIXES.weight), sample: SAMPLES.weight },
  { name: NAMES.typefaces, has: inGroup(TOKEN_GROUPS.font), sample: SAMPLES.family },
  { name: NAMES.typeScale, has: inGroup(TOKEN_GROUPS.fontSize), sample: SAMPLES.size },
  { name: NAMES.lineHeight, has: inGroup(TOKEN_GROUPS.line), sample: SAMPLES.line },
  { name: NAMES.tracking, has: named(TOKEN_PREFIXES.tracking), sample: SAMPLES.tracking },
  { name: NAMES.sizes, has: named(TOKEN_PREFIXES.size), sample: SAMPLES.bar },
  { name: NAMES.shadows, has: named(TOKEN_PREFIXES.shadow), sample: SAMPLES.shadow },
  {
    name: NAMES.motion,
    has: named(TOKEN_PREFIXES.ease, TOKEN_PREFIXES.duration, TOKEN_PREFIXES.opacity),
    sample: SAMPLES.none,
  },
  { name: NAMES.layout, has: () => true, sample: SAMPLES.none },
]

/** The tokens the Text section draws as whole styles, and the colours the Colour section does. */
const isDrawnElsewhere = (token: DesignToken): boolean =>
  token.group === TOKEN_GROUPS.colour || token.name.startsWith(TOKEN_PREFIXES.type)

const groupOf = (token: DesignToken): Group | undefined => GROUPS.find(({ has }) => has(token))

type GroupedRows = Array<{ name: string; rows: TokenRow[] }>

/** Every token but the colours and type styles, in the groups the page shows, each with its sample. */
export const groupTokens = (tokens: readonly DesignToken[]): GroupedRows => {
  const shown = tokens.filter((token) => !isDrawnElsewhere(token))
  return GROUPS.map((group) => ({
    name: group.name,
    rows: shown
      .filter((token) => groupOf(token) === group)
      .map((token) => ({ ...token, sample: group.sample })),
  })).filter(({ rows }) => rows.length > 0)
}
