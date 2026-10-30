export const LIBRARY_TOOLBAR_COPY = {
  sortInstead: (direction: string) => `Sort ${direction.toLowerCase()} instead`,
  order: 'Order: ',
  search: (name: string) => `Search ${name}`,
  groupBy: 'Group by',
  view: 'View',
} as const
