import { describe, expect, it } from 'bun:test'
import { RATING_KINDS, RATING_SOURCES } from '@raven/core'
import { artworkOfMedia, factsBefore, factsOf, posterOf } from '@/main/downloads/artwork'
import { summary } from '@/main/test/serverFakes'
import { mediaItemFor } from '@/shared/test/mediaItem'

describe('posterOf', () => {
  it('names the item and the poster version', () => {
    expect(posterOf({ id: 4, posterVersion: 'v9' })).toEqual({
      kind: 'poster',
      itemId: 4,
      version: 'v9',
    })
  })

  it('is none while the server has no poster', () => {
    expect(posterOf({ id: 4, posterVersion: null })).toEqual({ kind: 'none' })
  })
})

describe('artworkOfMedia', () => {
  it('is the matched item poster, and none for a file with no item', () => {
    const item = summary({ id: 3, posterVersion: 'v1' })
    expect(artworkOfMedia(mediaItemFor({ item }))).toEqual({
      kind: 'poster',
      itemId: 3,
      version: 'v1',
    })
    expect(artworkOfMedia(mediaItemFor({ item: null }))).toEqual({ kind: 'none' })
  })
})

describe('factsOf', () => {
  it('keeps what the library sorts a file on', () => {
    const media = mediaItemFor({
      width: 1920,
      height: 1080,
      bitrate: 6_000_000,
      item: summary({
        year: 1999,
        ratings: [
          { source: RATING_SOURCES.tmdb, kind: RATING_KINDS.audience, value: 8.1, votes: null },
        ],
      }),
    })
    expect(factsOf(media)).toEqual({
      year: 1999,
      score: 8.1,
      bitrate: 6_000_000,
      pixels: 1920 * 1080,
      addedAt: media.addedAt,
      changedAt: media.changedAt,
    })
  })

  it('leaves what a file lacks empty', () => {
    const facts = factsOf(mediaItemFor({ width: null, height: 720, year: 2004, item: null }))
    expect(facts.pixels).toBeNull()
    expect(facts.score).toBeNull()
    expect(facts.year).toBe(2004)
  })
})

describe('factsBefore', () => {
  it('dates a download from when it was confirmed', () => {
    expect(factsBefore({ createdAt: 0 })).toEqual({
      year: null,
      score: null,
      bitrate: null,
      pixels: null,
      addedAt: '1970-01-01T00:00:00.000Z',
      changedAt: '1970-01-01T00:00:00.000Z',
    })
  })
})
