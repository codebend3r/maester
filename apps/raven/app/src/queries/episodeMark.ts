type EpisodeMarkOfProps = { season: number | null; episode: number | null }

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * An episode's place in short: "S02 · E05", or "Special 5" for one of season 0; null without a
 * season. The pages and the player use it in place of the words, which crowd a TV.
 */
export const episodeMarkOf = ({ season, episode }: EpisodeMarkOfProps): string | null => {
  if (season === null) return null
  if (season === 0) return episode === null ? 'Specials' : `Special ${episode}`
  return episode === null ? `S${pad(season)}` : `S${pad(season)} · E${pad(episode)}`
}
