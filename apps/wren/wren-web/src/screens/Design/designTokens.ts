import { type DesignToken, TOKEN_GROUPS, parseThemes, parseTokens } from '@raven/core'
import { WREN_THEMES, type WrenThemeName } from '@raven/wren'
import { stylesheet } from '@/screens/Design/stylesheet'

/** The tokens `globals.scss` declares, read from the file itself so /design never falls behind it. */
export const designTokens: DesignToken[] = parseTokens(stylesheet)

export type Palette = { id: WrenThemeName; tokens: DesignToken[] }

/** Each theme's block of the stylesheet, by the name its `data-theme` says. */
const themeBlocks = parseThemes(stylesheet)

/**
 * Each theme's palette, in the order Settings offers the themes: the colours its
 * `[data-theme]` block declares. A new theme is a new block there and a name in `WREN_THEMES`.
 */
export const PALETTES: readonly Palette[] = Object.values(WREN_THEMES).map((id) => ({
  id,
  tokens: Object.entries(themeBlocks[id] ?? {}).map(([name, value]) => ({
    name,
    value,
    group: TOKEN_GROUPS.colour,
    note: null,
  })),
}))

/** The colours no theme changes, which `:root` alone declares: the logo's, the picture's and the art's. */
export const FIXED_COLOURS: DesignToken[] = designTokens.filter(
  ({ group }) => group === TOKEN_GROUPS.colour,
)

/** A type style's declaration, which the stylesheet wraps over two lines, so `parseTokens` skips it. */
const TYPE_DECLARATION = /^\s*(--type-[\w-]+):\s*([^;]+);/gm

/** The type styles, `--type-*`, read whole from the stylesheet and set on one line. */
export const TYPE_STYLES: DesignToken[] = [...stylesheet.matchAll(TYPE_DECLARATION)].map(
  ([, name = '', value = '']) => ({
    name,
    value: value.replace(/\s+/g, ' ').trim(),
    group: TOKEN_GROUPS.other,
    note: null,
  }),
)
