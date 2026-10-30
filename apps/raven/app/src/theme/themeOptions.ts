import { THEMES } from '@raven/core'

/** The theme picker, wherever it opens: Settings, or a TV's side menu. */
export const THEME_PICKER = {
  label: 'Theme',
  options: THEMES.map((theme) => ({ key: theme.id, label: theme.name })),
} as const
