/** The menus the bar's pills open, one at a time. */
export const MENU_SECTIONS = {
  subtitles: 'subtitles',
  audio: 'audio',
  playback: 'playback',
} as const

export type MenuSection = (typeof MENU_SECTIONS)[keyof typeof MENU_SECTIONS]

/** Each menu's name: its heading, and the first word of its pill. */
export const MENU_TITLES = {
  subtitles: 'Subtitles',
  audio: 'Audio',
  playback: 'Playback',
} as const satisfies Record<MenuSection, string>

export const isMenuSection = (value: unknown): value is MenuSection =>
  Object.values(MENU_SECTIONS).some((section) => section === value)
