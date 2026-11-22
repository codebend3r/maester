import { describe, expect, it } from 'bun:test'
import { MATCH_STATES } from '@raven/core'

import { FINISHED_SHOWN } from '@/library/libraryCounts'
import {
  albumIdsOf,
  inLibraryOrder,
  listedTracksOf,
  recentlyFinished,
  unmatchedAlbumsOf,
} from '@/library/listedTracks'
import { AIRBAG, LUCKY, OK_COMPUTER, OK_COMPUTER_PAGE, PARANOID, mediaOf } from '@/testing'

const READ = { failure: null, isRead: true, hasNoMusic: false }
const PAGE_READ = { data: OK_COMPUTER_PAGE, error: null, isSuccess: true }
const PAGE_PENDING = { data: undefined, error: null, isSuccess: false }
const DOWN = new Error('raven is out of reach')

describe('unmatchedAlbumsOf', () => {
  it('keeps the albums no release was found for', () => {
    const unmatched = { ...OK_COMPUTER, id: 8, match: MATCH_STATES.unmatched }
    const pending = { ...OK_COMPUTER, id: 9, match: MATCH_STATES.pending }
    expect(unmatchedAlbumsOf([OK_COMPUTER, unmatched, pending])).toEqual([unmatched])
  })
})

describe('inLibraryOrder', () => {
  it("keeps each library's entries as it sent them", () => {
    expect(inLibraryOrder([3, 1, 2])).toEqual([3, 1, 2])
  })
})

describe('recentlyFinished', () => {
  const entryOf = (at: number) => ({
    media: mediaOf(AIRBAG),
    lastPlayedAt: `2026-11-${String(at).padStart(2, '0')}T00:00:00Z`,
    plays: 1,
    furthest: 300,
    watched: true,
    marked: false,
  })

  it('puts the most recently played first, as many as the page shows', () => {
    const entries = Array.from({ length: FINISHED_SHOWN + 2 }, (_, at) => entryOf((at % 28) + 1))
    const shown = recentlyFinished(entries)
    expect(shown).toHaveLength(FINISHED_SHOWN)
    expect(shown[0]?.lastPlayedAt).toBe(entryOf(28).lastPlayedAt)
  })
})

describe('albumIdsOf', () => {
  it('names each album once, and none for a file of no album', () => {
    const film = { ...mediaOf(AIRBAG), id: 1, album: null }
    expect(albumIdsOf([mediaOf(AIRBAG), film, mediaOf(LUCKY)])).toEqual([OK_COMPUTER.id])
  })
})

describe('listedTracksOf', () => {
  it("lists the files as their albums' tracks, in the files' order", () => {
    const listed = listedTracksOf({
      media: [mediaOf(LUCKY), mediaOf(AIRBAG)],
      listing: READ,
      albums: [PAGE_READ],
    })
    expect(listed.tracks).toEqual([LUCKY, AIRBAG])
    expect(listed.listing).toEqual(READ)
  })

  it('is not read until every album is, and leaves out a file whose album has not answered', () => {
    const listed = listedTracksOf({
      media: [mediaOf(PARANOID)],
      listing: READ,
      albums: [PAGE_PENDING],
    })
    expect(listed.tracks).toEqual([])
    expect(listed.listing.isRead).toBe(false)
  })

  it("fails with the listing's failure first, else an album's", () => {
    const failed = { data: undefined, error: DOWN, isSuccess: false }
    const own = new Error('no listing')
    expect(listedTracksOf({ media: [], listing: READ, albums: [failed] }).listing.failure).toBe(
      DOWN,
    )
    expect(
      listedTracksOf({ media: [], listing: { ...READ, failure: own }, albums: [failed] }).listing
        .failure,
    ).toBe(own)
  })
})
