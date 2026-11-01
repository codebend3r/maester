import type { IconName } from '@raven/ui/iconDrawings'

/** The drawings Wren uses, from raven's own line icons, by what they mean here. */
export const WREN_ICONS = {
  home: 'home',
  library: 'music',
  search: 'search',
  settings: 'settings',
  back: 'back',
  play: 'play',
  pause: 'pause',
  previous: 'skipPrevious',
  next: 'skipNext',
  close: 'down',
  moveUp: 'up',
  remove: 'close',
  shuffle: 'shuffle',
  favourite: 'heart',
  more: 'more',
} as const satisfies Record<string, IconName>
