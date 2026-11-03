type StartProps = { season: number; episode: number }

export const BINGE_CARD_COPY = {
  starring: 'Starring',
  play: (title: string) => `Play ${title}`,
  start: ({ season, episode }: StartProps) => `Start season ${season} episode ${episode}`,
} as const
