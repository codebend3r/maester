import { describe, expect, it } from 'bun:test'

import { SONG_LEADS, SONG_LEAD_KINDS, songLeadOf } from '@/songLead'

const COVER = { src: '/cover' }
const ART = { kind: SONG_LEAD_KINDS.art, cover: COVER }
const NUMBER = { kind: SONG_LEAD_KINDS.number, number: '3' }

describe('songLeadOf', () => {
  it("lays the equalizer over a row's art while it is the queue's track", () => {
    expect(songLeadOf({ lead: ART, isCurrent: true })).toEqual({
      kind: SONG_LEADS.artEqualizer,
      cover: COVER,
    })
  })

  it("keeps the art alone on a row that is not the queue's track", () => {
    expect(songLeadOf({ lead: ART, isCurrent: false })).toEqual({
      kind: SONG_LEADS.art,
      cover: COVER,
    })
  })

  it("puts the equalizer in a numbered row's place while it is the queue's track", () => {
    expect(songLeadOf({ lead: NUMBER, isCurrent: true })).toEqual({ kind: SONG_LEADS.equalizer })
  })

  it('shows the number otherwise', () => {
    expect(songLeadOf({ lead: NUMBER, isCurrent: false })).toEqual({
      kind: SONG_LEADS.number,
      number: '3',
    })
  })
})
