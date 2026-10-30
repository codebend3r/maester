type HistoryIntroProps = { name: string; watchedPercent: number }

export const HISTORY_COPY = {
  noun: 'history',
  allPlayed: 'All played',
  intro: ({ name, watchedPercent }: HistoryIntroProps) =>
    `Videos played or marked in ${name}, last played first. One counts as watched once playback gets ${watchedPercent}% of the way through, or when it is marked, which the library's settings can change.`,
  show: 'Show',
  loading: 'Reading the history',
  nothingWatched: (name: string) => `Nothing watched in ${name} yet.`,
  nothingPlayed: (name: string) => `Nothing played in ${name} yet.`,
  showMore: 'Show more',
} as const
