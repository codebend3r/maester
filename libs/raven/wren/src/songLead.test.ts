import { describe, expect, it } from 'bun:test'

import { SONG_LEADS, songLeadOf } from '@/songLead'

describe('songLeadOf', () => {
  it('keeps the art on a row that has it, playing or not', () => {
    expect(songLeadOf({ hasArt: true, isPlaying: true })).toBe(SONG_LEADS.art)
    expect(songLeadOf({ hasArt: true, isPlaying: false })).toBe(SONG_LEADS.art)
  })

  it("puts the equalizer in a numbered row's place while it is the queue's track", () => {
    expect(songLeadOf({ hasArt: false, isPlaying: true })).toBe(SONG_LEADS.equalizer)
  })

  it('shows the number otherwise', () => {
    expect(songLeadOf({ hasArt: false, isPlaying: false })).toBe(SONG_LEADS.number)
  })
})
