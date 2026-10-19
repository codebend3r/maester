export const THEME_TONES = { dark: 'dark', light: 'light' } as const

export type ThemeTone = (typeof THEME_TONES)[keyof typeof THEME_TONES]

type Theme = {
  id: string
  name: string
  /** One line under the name in the picker: the ground, then what Play wears. */
  note: string
  /** A light theme wears the logo drawn for light grounds. */
  tone: ThemeTone
}

/**
 * The themes a viewer can pick, Verdigris first as the default. Their
 * colours live in styles/themes.scss under each id, and nowhere else.
 */
export const THEMES = [
  { id: 'verdigris', name: 'Verdigris', note: 'Dark teal, oxblood play', tone: THEME_TONES.dark },
  { id: 'bronze', name: 'Bronze', note: 'Warm umber, verdigris play', tone: THEME_TONES.dark },
  { id: 'nocturne', name: 'Nocturne', note: 'Ink blue, copper play', tone: THEME_TONES.dark },
  { id: 'oxblood', name: 'Oxblood', note: 'Deep wine, gilt play', tone: THEME_TONES.dark },
  { id: 'patina', name: 'Patina', note: 'Light parchment, teal ink', tone: THEME_TONES.light },
  { id: 'mint', name: 'Mint', note: 'Cool mint, coral play', tone: THEME_TONES.light },
  {
    id: 'contrast',
    name: 'High contrast',
    note: 'Black, white and yellow, 7:1 or more',
    tone: THEME_TONES.dark,
  },
] as const satisfies readonly Theme[]

export type ThemeId = (typeof THEMES)[number]['id']

export const DEFAULT_THEME = 'verdigris' satisfies ThemeId

export const isThemeId = (value: unknown): value is ThemeId =>
  THEMES.some((theme) => theme.id === value)

/** The theme by its id. */
export const themeOf = (id: ThemeId): (typeof THEMES)[number] =>
  THEMES.find((theme) => theme.id === id) ?? THEMES[0]
