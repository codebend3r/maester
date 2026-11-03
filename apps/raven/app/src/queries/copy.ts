export const LIBRARY_GRID_COPY = {
  videos: { one: 'video', many: 'videos' },
  shows: { one: 'show', many: 'shows' },
  episodes: { one: 'episode', many: 'episodes' },
  matched: 'Matched',
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
