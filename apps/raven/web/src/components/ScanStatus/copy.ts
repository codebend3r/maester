type WalkingOfProps = { found: string; expected: string }

type IndexingProps = { processed: string; found: string }

export const SCAN_STATUS_COPY = {
  justNow: 'just now',
  minutesAgo: (minutes: number) => `${minutes} min ago`,
  hoursAgo: (hours: number) => `${hours} h ago`,
  walking: 'Looking through the folders',
  walkingSoFar: (videos: string) => `Looking through the folders, ${videos} found so far`,
  walkingOf: ({ found, expected }: WalkingOfProps) =>
    `Looking through the folders, ${found} of about ${expected} found`,
  matching: 'Matching the new videos',
  indexing: ({ processed, found }: IndexingProps) => `Indexing ${processed} of ${found}`,
  fullScan: (when: string) => `Full scan ${when}`,
  noFullScan: 'No full scan yet',
  quickScan: (when: string) => `Quick scan ${when}`,
  progress: 'Scan progress',
} as const
