/** What a page's Watched mark says beside its check on a phone: the phone app's words. */
export const WATCHED_TOGGLE_COPY = {
  show: { mark: 'Mark show watched', marked: 'Show watched' },
  season: { mark: 'Mark season watched', marked: 'Season watched' },
} as const

/** What pressing the mark does until all of it is watched, then that it is. */
export type PhoneWatchedWords = (typeof WATCHED_TOGGLE_COPY)[keyof typeof WATCHED_TOGGLE_COPY]
