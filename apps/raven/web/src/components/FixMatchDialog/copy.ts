import { ITEM_TYPES } from '@raven/core'

type NamedProps = { title: string; year: number }

export const FIX_MATCH_DIALOG_COPY = {
  notA: {
    [ITEM_TYPES.movie]: 'Not a movie',
    [ITEM_TYPES.show]: 'Not a show',
  },
  named: ({ title, year }: NamedProps) => `${title} (${year})`,
  chooseLabel: (name: string) => `Choose ${name}`,
  choose: 'Choose',
  search: 'Search',
  failed: 'Something went wrong.',
  results: 'Results',
  noResults: 'TMDB has nothing by that name. Try the original title, or no year.',
  searching: 'Searching TMDB',
} as const
