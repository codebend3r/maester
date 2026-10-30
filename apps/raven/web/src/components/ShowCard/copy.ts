type PlayEpisodeProps = { title: string; code: string }

export const SHOW_CARD_COPY = {
  playShow: (title: string) => `Play ${title}`,
  playEpisode: ({ title, code }: PlayEpisodeProps) => `Play ${title} ${code}`,
  allWatched: 'All watched',
  shows: 'Shows',
  years: 'Years',
  episodes: 'Episodes',
  rottenTomatoes: 'RT',
  metacritic: 'Metacritic',
} as const
