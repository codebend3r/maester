import { describe, expect, it } from 'bun:test'

import { ITEM_TYPES, SESSION_KINDS } from '@raven/core'

import { viewingOf } from '@/player/viewing'

describe('viewingOf', () => {
  it('keeps the session the viewer chose', () => {
    const saga = { kind: SESSION_KINDS.saga, sagaId: '10' } as const
    expect(viewingOf({ chosen: saga, itemType: ITEM_TYPES.movie })).toEqual(saga)
  })

  it('walks the show for an episode with no choice', () => {
    expect(viewingOf({ chosen: null, itemType: ITEM_TYPES.episode })).toEqual({
      kind: SESSION_KINDS.show,
    })
  })

  it('plays a film or an unknown video alone', () => {
    expect(viewingOf({ chosen: null, itemType: ITEM_TYPES.movie })).toEqual({
      kind: SESSION_KINDS.single,
    })
    expect(viewingOf({ chosen: null, itemType: null })).toEqual({ kind: SESSION_KINDS.single })
  })
})
