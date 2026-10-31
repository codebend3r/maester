import { describe, expect, it } from 'bun:test'
import {
  MIX_KINDS,
  RADIO_SEED_KINDS,
  isMixSummary,
  radioSeedOf,
  radioSeedText,
} from '@/contract/mixes'
import { QUEUE_SOURCE_KINDS, isQueueSource } from '@/queue'

describe('radio seeds', () => {
  it('reads back what it writes', () => {
    const seed = { kind: RADIO_SEED_KINDS.artist, id: 42 }
    expect(radioSeedText(seed)).toBe('artist:42')
    expect(radioSeedOf(radioSeedText(seed))).toEqual(seed)
  })

  it('refuses a kind it does not know, an id that is no whole number from 1, or no text', () => {
    expect(radioSeedOf('genre:4')).toBeNull()
    expect(radioSeedOf('track:0')).toBeNull()
    expect(radioSeedOf('track:1.5')).toBeNull()
    expect(radioSeedOf('track:')).toBeNull()
    expect(radioSeedOf(['track:1'])).toBeNull()
  })
})

describe('mixes on the wire', () => {
  it('names a mix by its kind', () => {
    const summary = { id: MIX_KINDS.rediscover, trackCount: 12, duration: 3000, covers: [] }
    expect(isMixSummary(summary)).toBe(true)
    expect(isMixSummary({ ...summary, id: 'weekly' })).toBe(false)
  })

  it('keeps a mix by its kind and a radio by its seed as a queue source', () => {
    expect(isQueueSource({ kind: QUEUE_SOURCE_KINDS.mix, id: MIX_KINDS.onThisDay })).toBe(true)
    expect(isQueueSource({ kind: QUEUE_SOURCE_KINDS.mix, id: 3 })).toBe(false)
    expect(
      isQueueSource({ kind: QUEUE_SOURCE_KINDS.radio, id: 3, seed: RADIO_SEED_KINDS.album }),
    ).toBe(true)
    expect(isQueueSource({ kind: QUEUE_SOURCE_KINDS.radio, id: 3 })).toBe(false)
    expect(isQueueSource({ kind: QUEUE_SOURCE_KINDS.album, id: 3 })).toBe(true)
  })
})
