export type TokenGroup = 'colour' | 'space' | 'radius' | 'font' | 'font-size' | 'line' | 'other'

/** One custom property declared on :root, and the comment written above it. */
export type DesignToken = {
  name: string
  value: string
  group: TokenGroup
  note: string | null
}

/** Longest prefix first, so `--font-size-` is not read as `--font-`. */
const GROUPS: ReadonlyArray<[string, TokenGroup]> = [
  ['--color-', 'colour'],
  ['--space-', 'space'],
  ['--radius-', 'radius'],
  ['--font-size-', 'font-size'],
  ['--font-', 'font'],
  ['--line-', 'line'],
]

const groupOf = (name: string): TokenGroup =>
  GROUPS.find(([prefix]) => name.startsWith(prefix))?.[1] ?? 'other'

const DECLARATION = /^(--[\w-]+):\s*(.+);$/
const COMMENT = /^\/\/\s?(.*)$/

type Reading = { tokens: DesignToken[]; comment: string[] }

/**
 * Reads the design tokens out of a stylesheet's `:root` block, in the order
 * they are declared. A `//` comment directly above a token is its note; a
 * blank line in between, or any other declaration, drops it.
 */
export const parseTokens = (scss: string): DesignToken[] => {
  const start = scss.indexOf(':root {')
  if (start === -1) return []
  const end = scss.indexOf('\n}', start)
  const lines = scss
    .slice(start + ':root {'.length, end === -1 ? undefined : end)
    .split('\n')
    .map((line) => line.trim())
  return lines.reduce<Reading>(
    (reading, line) => {
      const comment = COMMENT.exec(line)
      if (comment) return { ...reading, comment: [...reading.comment, comment[1] ?? ''] }
      const declaration = DECLARATION.exec(line)
      if (!declaration) return { ...reading, comment: [] }
      const [, name = '', value = ''] = declaration
      const note = reading.comment.join(' ').trim()
      return {
        tokens: [...reading.tokens, { name, value, group: groupOf(name), note: note || null }],
        comment: [],
      }
    },
    { tokens: [], comment: [] },
  ).tokens
}

const HEX = /^#([0-9a-f]{6})$/i

/** WCAG relative luminance of a `#rrggbb` colour. */
const luminance = (hex: string): number => {
  const [red = 0, green = 0, blue = 0] = [0, 2, 4]
    .map((offset) => Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/**
 * The WCAG contrast ratio between two `#rrggbb` colours, 1 to 21, whichever
 * way round they are. Null for anything else (a colour with alpha depends
 * on what is under it).
 */
export const contrastRatio = ({
  foreground,
  background,
}: {
  foreground: string
  background: string
}): number | null => {
  if (!HEX.test(foreground) || !HEX.test(background)) return null
  const [lighter = 0, darker = 0] = [luminance(foreground), luminance(background)].toSorted(
    (a, b) => b - a,
  )
  return (lighter + 0.05) / (darker + 0.05)
}
