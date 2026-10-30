import { COMMON_COPY } from '@/lib/copy'

export const SEASON_COPY = {
  noun: 'season',
  episodeNumber: (episode: number) => `E${episode}`,
  watched: (title: string) => `Watched ${title}`,
  playEpisode: (title: string) => `Play ${title}`,
  play: (code: string | null) => (code ? `Play ${code}` : COMMON_COPY.play),
  shuffleSeason: 'Shuffle season',
  shuffleShow: 'Shuffle show',
  episodes: 'Episodes',
} as const
