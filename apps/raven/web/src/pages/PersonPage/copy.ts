import { plural } from '@raven/core'

import { COMMON_COPY } from '@/lib/copy'

type DiedAgedProps = { day: string; age: number }

type TabWithCountProps = { label: string; count: string }

export const PERSON_COPY = {
  noun: 'page',
  groups: {
    acting: 'Acting',
    directing: 'Directing',
    writing: 'Writing',
    producing: 'Producing',
  },
  departments: {
    acting: 'Acting',
    directing: 'Directing',
    writing: 'Writing',
    producing: 'Producing',
    crew: 'Crew',
  },
  tabs: {
    all: 'All',
    acting: 'Acting',
    directing: 'Directing',
    writing: 'Writing',
    producing: 'Producing',
  },
  titles: (count: number) => plural({ n: count, one: 'title', many: 'titles' }),
  titlesOnRaven: (count: number) =>
    `${plural({ n: count, one: 'title', many: 'titles' })} on raven`,
  inYourLibraries: (count: number) =>
    `In your libraries${COMMON_COPY.separator}${plural({ n: count, one: 'credit', many: 'credits' })}`,
  tmdbUnreachable: 'TMDB could not be reached, so this lists only what raven holds.',
  nothingCredits: (name: string) => `Nothing in raven credits ${name} yet.`,
  filmography: 'Filmography',
  fetchingFilmography: (name: string) => `Fetching ${name}'s filmography`,
  noTitles: (name: string) => `TMDB lists no titles for ${name}.`,
  noMatch: (query: string) => `No titles match "${query}".`,
  born: (day: string) => `Born ${day}`,
  bornIn: (place: string) => ` in ${place}`,
  yearsOld: (age: number) => plural({ n: age, one: 'year old', many: 'years old' }),
  died: (day: string) => `Died ${day}`,
  diedAged: ({ day, age }: DiedAgedProps) => `Died ${day}, aged ${age}`,
  less: 'Less',
  more: 'More',
  undated: 'TBA',
  onTmdb: ' on TMDB',
  movie: 'Movie',
  tv: 'TV',
  titleOnRaven: (title: string) => `${title} on raven`,
  onRaven: 'On raven',
  notOnRaven: 'Not on raven',
  role: 'Role',
  department: 'Department',
  searchTitles: 'Search titles',
  showSelf: 'Show appearances as themselves',
  credits: 'Credits',
  tabWithCount: ({ label, count }: TabWithCountProps) => `${label}, ${count}`,
} as const
