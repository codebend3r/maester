/** The play history's pages: each account's own, and everyone's for the owner. */
export const PLAY_HISTORY_ROUTES = {
  own: '/history',
  everyone: '/history/everyone',
} as const

/** The address's search params the pages read. */
export const PLAY_HISTORY_SEARCH = { show: 'show', account: 'account' } as const
