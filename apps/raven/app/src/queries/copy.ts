export const LIBRARY_GRID_COPY = {
  videos: { one: 'video', many: 'videos' },
  shows: { one: 'show', many: 'shows' },
  episodes: { one: 'episode', many: 'episodes' },
  matched: 'Matched',
  /** Between a show panel's facts: "1 season · 6 episodes". */
  factsSeparator: ' · ',
  notMatched: (count: string) => `Not matched, ${count}`,
} as const

export const ITEM_PAGE_COPY = {
  show: 'Show',
  episodes: { one: 'episode', many: 'episodes' },
  episodeNumber: (episode: number) => `E${episode}`,
} as const

export const HOME_HERO_COPY = {
  featuredIn: (library: string) => `Featured in ${library}`,
  episodes: { one: 'episode', many: 'episodes' },
} as const

/** A card on the Libraries screen, in the web card's words: its type, a lock, its counts. */
export const LIBRARY_LIST_COPY = {
  separator: ' · ',
  locked: 'Locked',
  libraries: { one: 'library', many: 'libraries' },
  videos: { one: 'video', many: 'videos' },
  notMatched: (count: string) => `${count} not matched`,
} as const

/** The ways up from a video, as an item page's buttons and a card's menu both say them. */
export const ITEM_LINK_COPY = {
  /** "Go to Severance": the way up from an episode to its show or season. */
  goTo: (title: string) => `Go to ${title}`,
  /** "View saga The Lord of the Rings Collection": the way from a movie to its saga. */
  viewSaga: (name: string) => `View saga ${name}`,
} as const
