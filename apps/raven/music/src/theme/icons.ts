import type { IconName } from '@raven/ui/iconDrawings'

/** The drawings Wren uses, from raven's own line icons, by what they mean here. */
export const WREN_ICONS = {
  home: 'home',
  library: 'music',
  search: 'search',
  settings: 'settings',
  back: 'back',
  play: 'play',
  shuffle: 'shuffle',
  favourite: 'heart',
  more: 'more',
  cover: 'disc',
} as const satisfies Record<string, IconName>
