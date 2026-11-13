import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES, WATCHED_STATES, type ItemDetails } from '@raven/core'
import { mediaItemFor, summaryFor } from '@raven/native/testing'

import { itemWatchedStateOf } from '@/queries/itemWatched'

const detailsFor = (overrides: Partial<ItemDetails>): ItemDetails => ({
  ...summaryFor({ id: 1, title: 'Busboys' }),
  tmdbId: '1',
  imdbId: null,
  originalTitle: null,
  tagline: null,
  summary: null,
  contentRating: null,
  released: null,
  ended: null,
  runtime: null,
  studio: null,
  genres: [],
  logoVersion: null,
  favourite: null,
  aiMatch: null,
  credits: [],
  reviews: [],
  versions: [],
  children: [],
  libraryPictures: [],
  ...overrides,
})

describe('itemWatchedStateOf', () => {
  it("counts a show's seasons, a season's episodes, and a video's files", () => {
    const season = {
      ...summaryFor({ id: 5, type: ITEM_TYPES.season, title: 'Season 1', season: 1 }),
      type: ITEM_TYPES.season,
      episodeCount: 2,
      watchedCount: 1,
      runtime: null,
    } as const
    const show = detailsFor({ type: ITEM_TYPES.show, children: [season] })
    expect(itemWatchedStateOf(show)).toBe(WATCHED_STATES.partly)

    const watchedMovie = detailsFor({
      type: ITEM_TYPES.movie,
      versions: [mediaItemFor({ id: 2, watched: true })],
    })
    expect(itemWatchedStateOf(watchedMovie)).toBe(WATCHED_STATES.watched)
    expect(itemWatchedStateOf(detailsFor({ type: ITEM_TYPES.movie }))).toBe(
      WATCHED_STATES.unwatched,
    )
  })
})
