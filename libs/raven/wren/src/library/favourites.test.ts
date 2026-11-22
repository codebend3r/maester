import { describe, expect, it } from 'bun:test'
import { plural } from '@raven/core'
import { COUNTS_COPY, KIT_COPY } from '@/copy/kit'
import { favouritesOf } from '@/library/favourites'
import type { ListState } from '@/library/listState'

const READ: ListState = { failure: null, isRead: true, hasNoMusic: false }
const READING: ListState = { failure: null, isRead: false, hasNoMusic: false }

describe('favouritesOf', () => {
  it('counts the lists that hold something once all are read', () => {
    const favourites = favouritesOf({
      artists: { count: 2, listing: READ },
      albums: { count: 0, listing: READ },
      tracks: { count: 1, listing: READ },
    })
    expect(favourites.isEmpty).toBe(false)
    expect(favourites.countLine).toBe(
      KIT_COPY.facts([
        plural({ n: 2, ...COUNTS_COPY.artists }),
        plural({ n: 1, ...COUNTS_COPY.songs }),
      ]),
    )
  })

  it('says no count while a list is still read', () => {
    const favourites = favouritesOf({
      artists: { count: 2, listing: READING },
      albums: { count: 0, listing: READ },
      tracks: { count: 0, listing: READ },
    })
    expect(favourites.listing.isRead).toBe(false)
    expect(favourites.countLine).toBeNull()
  })

  it('takes the first failure and counts nothing past it', () => {
    const failure = new Error('refused')
    const favourites = favouritesOf({
      artists: { count: 0, listing: READ },
      albums: { count: 3, listing: { ...READ, failure } },
      tracks: { count: 0, listing: READ },
    })
    expect(favourites.listing.failure).toBe(failure)
    expect(favourites.countLine).toBeNull()
  })

  it('is empty when no list holds anything', () => {
    const favourites = favouritesOf({
      artists: { count: 0, listing: READ },
      albums: { count: 0, listing: READ },
      tracks: { count: 0, listing: READ },
    })
    expect(favourites.isEmpty).toBe(true)
    expect(favourites.countLine).toBeNull()
  })
})
