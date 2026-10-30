import { RATING_SOURCES } from '@raven/core'

import { COMMON_COPY } from '@/lib/copy'

type ScoreSaidProps = { site: string; score: string; spoken: string }
type ItemLabelProps = ScoreSaidProps & { meaning: string }

const scoreSaid = ({ site, score, spoken }: ScoreSaidProps) => `${site}: ${score}${spoken}`

export const RATING_PANEL_COPY = {
  sources: {
    [RATING_SOURCES.rottenTomatoes]: {
      label: 'Tomatometer',
      meaning: 'Critics who reviewed it positively',
      shown: '%',
      spoken: '%',
    },
    [RATING_SOURCES.imdb]: {
      label: COMMON_COPY.imdb,
      meaning: 'Average user rating',
      shown: '/10',
      spoken: ' out of 10',
    },
    [RATING_SOURCES.metacritic]: {
      label: 'Metascore',
      meaning: 'Weighted critic score',
      shown: '/100',
      spoken: ' out of 100',
    },
    [RATING_SOURCES.tmdb]: {
      label: COMMON_COPY.tmdb,
      meaning: 'Average user rating',
      shown: '/10',
      spoken: ' out of 10',
    },
  },
  itemLabel: ({ meaning, ...said }: ItemLabelProps) => `${scoreSaid(said)}. ${meaning}.`,
  badgeLabel: scoreSaid,
  chipEntry: ({ site, score, spoken }: ScoreSaidProps) => `${site} ${score}${spoken}`,
  chipLabel: (spoken: string) => `Ratings: ${spoken}`,
  more: (count: number) => `+${count}`,
  ratings: 'Ratings',
} as const
