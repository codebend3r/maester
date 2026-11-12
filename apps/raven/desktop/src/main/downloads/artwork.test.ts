import { describe, expect, it } from 'bun:test'
import { factsBefore } from '@/main/downloads/artwork'

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
