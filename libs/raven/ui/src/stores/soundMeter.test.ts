import { afterEach, describe, expect, it } from 'bun:test'
import { type SoundLevels, useSoundMeter } from '@/stores/soundMeter'

const steady =
  (level: number): SoundLevels =>
  ({ count }) =>
    Array.from({ length: count }, () => level)

describe('useSoundMeter', () => {
  afterEach(() => {
    useSoundMeter.setState({ levels: null })
  })

  it('reads the claimed levels until they are released', () => {
    const levels = steady(1)
    const release = useSoundMeter.getState().claim(levels)
    expect(useSoundMeter.getState().levels).toBe(levels)
    release()
    expect(useSoundMeter.getState().levels).toBeNull()
  })

  it('leaves alone a meter another reader has claimed since', () => {
    const release = useSoundMeter.getState().claim(steady(1))
    const other = steady(0.5)
    useSoundMeter.getState().claim(other)
    release()
    expect(useSoundMeter.getState().levels).toBe(other)
  })
})
