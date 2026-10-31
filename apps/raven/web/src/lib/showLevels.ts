/**
 * What a TV library's page lists: its shows, every season of them, or every
 * episode. It opens on its shows each time; the choice lasts while the page is open.
 */
export const SHOW_LEVELS = { shows: 'shows', seasons: 'seasons', episodes: 'episodes' } as const

export type ShowLevel = (typeof SHOW_LEVELS)[keyof typeof SHOW_LEVELS]

export const isShowLevel = (value: string): value is ShowLevel =>
  Object.values<string>(SHOW_LEVELS).includes(value)
