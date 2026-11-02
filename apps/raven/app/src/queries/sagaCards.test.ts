import { describe, expect, it } from 'bun:test'

import { LIBRARY_KINDS, SESSION_KINDS } from '@raven/core'

import { hasSagas, sagaPlayTarget } from '@/queries/sagaCards'
import { ROUTE_TARGETS } from '@/routes'

describe('hasSagas', () => {
  it('is for the libraries whose files are matched to movies alone', () => {
    expect(hasSagas(LIBRARY_KINDS.movies)).toBe(true)
    expect(hasSagas(LIBRARY_KINDS.shows)).toBe(false)
  })
})

describe('sagaPlayTarget', () => {
  const played = (mediaId: number) => ({
    kind: ROUTE_TARGETS.play,
    mediaId,
    at: 0,
    session: { kind: SESSION_KINDS.saga, sagaId: '77' },
  })

  it("plays the first movie not yet watched, in the saga's session", () => {
    const media = [
      { id: 1, watched: true },
      { id: 2, watched: false },
      { id: 3, watched: false },
    ]
    expect(sagaPlayTarget({ sagaId: '77', media })).toEqual(played(2))
  })

  it('plays the first movie again once every one is watched', () => {
    const media = [
      { id: 1, watched: true },
      { id: 2, watched: true },
    ]
    expect(sagaPlayTarget({ sagaId: '77', media })).toEqual(played(1))
  })

  it('plays nothing for a saga with no movie', () => {
    expect(sagaPlayTarget({ sagaId: '77', media: [] })).toBeNull()
  })
})
