import { describe, expect, it } from 'bun:test'

import { introOfferOf } from '@/layouts/introOffer'
import { PLAYER_COPY } from '@/layouts/playerKit'

const skip = () => {}
const undo = () => {}

describe('introOfferOf', () => {
  it('offers Skip intro while the video is inside the intro', () => {
    expect(introOfferOf({ isInside: true, isPrompting: true, skip, undo: null })).toEqual({
      label: PLAYER_COPY.skipIntro,
      onPress: skip,
      isPrompting: true,
    })
  })

  it('offers Undo skip after the intro skipped by itself', () => {
    expect(introOfferOf({ isInside: false, isPrompting: true, skip, undo })).toEqual({
      label: PLAYER_COPY.undoSkip,
      onPress: undo,
      isPrompting: true,
    })
  })

  it('offers nothing outside the intro', () => {
    expect(introOfferOf({ isInside: false, isPrompting: false, skip, undo: null })).toBeNull()
  })
})
