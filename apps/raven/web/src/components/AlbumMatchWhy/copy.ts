import { MATCH_FACTS, type MatchFact } from '@raven/core'

type ClosestProps = { title: string; artist: string; year: number | null }

type ValuesProps = { album: string; release: string }

type PointsProps = { points: number; most: number }

export const ALBUM_MATCH_WHY_COPY = {
  looking: 'Looking for the closest release…',
  failed: (reason: string) => `Could not check this album: ${reason}`,
  score: (confidence: number) => `Closest match: ${confidence} of 100, 80 needed`,
  nothingFound: 'MusicBrainz found nothing for these tags',
  closest: ({ title, artist, year }: ClosestProps) =>
    year === null ? `${title} by ${artist}` : `${title} by ${artist}, ${year}`,
  points: ({ points, most }: PointsProps) => `${points} of ${most}`,
  values: ({ album, release }: ValuesProps) => `Yours: ${album}. MusicBrainz: ${release}.`,
  noValue: 'none',
  official: 'An official release',
  notOfficial: 'Not an official release',
  reason: 'Smart match says:',
  fixHeading: 'How to fix',
  fixes: {
    [MATCH_FACTS.title]: (title: string) => `Rename the title to “${title}”.`,
    [MATCH_FACTS.artist]: (artist: string) => `Set the album artist to “${artist}”.`,
    [MATCH_FACTS.year]: (year: string) => `Set the year to ${year}.`,
    [MATCH_FACTS.trackCount]: (count: string) =>
      `Check for missing or extra tracks; MusicBrainz lists ${count}.`,
  },
  fixNothingFound: 'Check the title and artist tags, or use Fix match.',
  fixOtherwise: 'Use Fix match to choose the release.',
  facts: {
    [MATCH_FACTS.title]: 'Title',
    [MATCH_FACTS.artist]: 'Artist',
    [MATCH_FACTS.year]: 'Year',
    [MATCH_FACTS.trackCount]: 'Tracks',
    [MATCH_FACTS.official]: 'Release status',
  } as const satisfies Record<MatchFact, string>,
} as const
