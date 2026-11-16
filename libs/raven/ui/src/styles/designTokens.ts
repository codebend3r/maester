import { parseThemes, parseTokens } from '@raven/core'
import globals from '@/styles/globals.scss?raw'
import themes from '@/styles/themes.scss?raw'

/** The tokens globals.scss declares, read from the file itself so /design never falls behind it. */
export const designTokens = parseTokens(globals)

/** The same tokens' values by name, for a host that reads each by its custom property. */
export const designTokenValues: Readonly<Record<string, string>> = Object.fromEntries(
  designTokens.map(({ name, value }) => [name, value]),
)

/** Each theme's colours from themes.scss, by theme id, for a host that cannot read the stylesheet. */
export const themeTokens = parseThemes(themes)
