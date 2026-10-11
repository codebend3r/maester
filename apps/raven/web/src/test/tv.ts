import type { EpisodeSummary, ItemDetails, MediaItem, SeasonSummary } from '@raven/core'
import { itemDetails, itemSummary, mediaItem } from '@/test/fixtures'

const SEASON_ONE_CARD = itemSummary({
  id: 5,
  type: 'season',
  title: 'Season 1',
  year: 2022,
  show: { id: 4, title: 'Severance' },
  season: 1,
  posterVersion: 'p5',
})

/** Season 1 as its show's page lists it. */
export const SEASON_ONE_SUMMARY: SeasonSummary = {
  ...SEASON_ONE_CARD,
  type: 'season',
  episodeCount: 2,
}

/** A show, its first season and two episodes, as the item routes would answer. */
export const SEVERANCE: ItemDetails = itemDetails({
  ...itemSummary({ id: 4, type: 'show', title: 'Severance', year: 2022, posterVersion: 's4' }),
  tmdbId: '95396',
  tagline: 'Work is a mystery.',
  summary: 'Mark leads a team of office workers whose memories have been surgically divided.',
  contentRating: 'TV-MA',
  released: '2022-02-18',
  ended: null,
  runtime: 45,
  studio: 'Apple TV+',
  genres: ['Drama', 'Mystery', 'Science Fiction', 'Thriller'],
  credits: [
    { personId: 10, name: 'Adam Scott', job: 'cast', role: 'Mark Scout', photoVersion: null },
    { personId: 11, name: 'Dan Erickson', job: 'creator', role: 'Creator', photoVersion: null },
  ],
  versions: [],
  children: [SEASON_ONE_SUMMARY],
})

export const EPISODE_ONE = mediaItem({
  id: 12,
  title: 'Severance - S01E01 - Good News About Hell',
  fileName: 'Severance - S01E01 - Good News About Hell.mkv',
  duration: 3400,
  match: 'matched',
  item: itemSummary({
    id: 6,
    type: 'episode',
    title: 'Good News About Hell',
    year: 2022,
    show: { id: 4, title: 'Severance' },
    season: 1,
    episode: 1,
    posterVersion: null,
  }),
})

export const EPISODE_TWO = mediaItem({
  id: 13,
  title: 'Severance - S01E02 - Half Loop',
  fileName: 'Severance - S01E02 - Half Loop.mkv',
  duration: 3300,
  position: 600,
  match: 'matched',
  item: itemSummary({
    id: 7,
    type: 'episode',
    title: 'Half Loop',
    year: 2022,
    show: { id: 4, title: 'Severance' },
    season: 1,
    episode: 2,
    posterVersion: null,
  }),
})

/** An episode as its season's page lists it: its row, and the file Play starts. */
export const episodeRow = (media: MediaItem): EpisodeSummary => ({
  ...(media.item ?? itemSummary()),
  type: 'episode',
  summary: `${media.item?.title ?? ''} is an episode.`,
  released: '2022-02-18',
  runtime: 55,
  stillVersion: 'still1',
  primary: media,
})

export const SEASON_ONE: ItemDetails = itemDetails({
  ...SEASON_ONE_CARD,
  tmdbId: '134430',
  tagline: null,
  summary: 'The first season.',
  contentRating: null,
  released: '2022-02-18',
  runtime: null,
  studio: null,
  genres: [],
  backdropVersion: null,
  ratings: [],
  credits: [],
  versions: [],
  children: [EPISODE_ONE, EPISODE_TWO].map(episodeRow),
})

export const episodeDetails = (media: typeof EPISODE_ONE): ItemDetails =>
  itemDetails({
    ...(media.item ?? itemSummary()),
    tmdbId: `${media.id}`,
    tagline: null,
    summary: `${media.item?.title ?? ''} is an episode.`,
    contentRating: null,
    released: '2022-02-18',
    runtime: 55,
    studio: null,
    genres: [],
    backdropVersion: 'still1',
    ratings: [{ source: 'tmdb', kind: 'audience', value: 8.1, votes: 40 }],
    credits: [
      {
        personId: 20,
        name: 'Tramell Tillman',
        job: 'guest',
        role: 'Mr. Milchick',
        photoVersion: null,
      },
      { personId: 21, name: 'Ben Stiller', job: 'director', role: 'Director', photoVersion: null },
    ],
    versions: [media],
    children: [],
  })
