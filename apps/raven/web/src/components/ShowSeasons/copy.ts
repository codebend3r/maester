import { SEASON_VIEWS, type SeasonView } from '@/stores/seasonView'

type WatchedOfProps = { watched: number; total: number }

export const SHOW_SEASONS_COPY = {
  factSeparator: ' · ',
  heading: 'Seasons',
  view: 'Season layout',
  views: {
    [SEASON_VIEWS.grid]: 'Grid',
    [SEASON_VIEWS.table]: 'Table',
  } as const satisfies Record<SeasonView, string>,
  columns: {
    season: 'Season',
    episodes: 'Episodes',
    watched: 'Watched',
    runtime: 'Runtime',
  },
  watched: ({ watched, total }: WatchedOfProps) => `${watched} of ${total}`,
  noRuntime: 'Unknown',
} as const
