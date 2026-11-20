type SeenProps = { watched: number; total: number }

type PercentProps = { percent: number }

export const BINGE_ROW_COPY = {
  episodesSeen: ({ watched, total }: SeenProps) =>
    `${watched} of ${total} ${total === 1 ? 'episode' : 'episodes'}`,
  percentSeen: ({ percent }: PercentProps) => `${percent}%`,
  seenLabel: ({ watched, total }: SeenProps) => `${watched} of ${total} episodes watched`,
} as const
