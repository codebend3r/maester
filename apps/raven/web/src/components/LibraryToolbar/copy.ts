import { SHOW_LEVELS, type ShowLevel } from '@/lib/showLevels'

export const LIBRARY_TOOLBAR_COPY = {
  sortInstead: (direction: string) => `Sort ${direction.toLowerCase()} instead`,
  order: 'Order: ',
  search: (name: string) => `Search ${name}`,
  groupBy: 'Group by',
  view: 'View',
  showBy: 'Show',
  levels: {
    [SHOW_LEVELS.shows]: 'Shows',
    [SHOW_LEVELS.seasons]: 'Seasons',
    [SHOW_LEVELS.episodes]: 'Episodes',
  } as const satisfies Record<ShowLevel, string>,
} as const
