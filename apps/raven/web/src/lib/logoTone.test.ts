import { describe, expect, it } from 'bun:test'
import { logoTone, toneOfPixels } from '@/lib/logoTone'

/** RGBA bytes for pixels of one grey, at one opacity. */
const pixels = ({ grey, alpha, count }: { grey: number; alpha: number; count: number }) =>
  Array.from({ length: count }, () => [grey, grey, grey, alpha]).flat()

describe('toneOfPixels', () => {
  it('reads mostly dark, mostly light, and in between', () => {
    expect(toneOfPixels(pixels({ grey: 20, alpha: 255, count: 4 }))).toBe('dark')
    expect(toneOfPixels(pixels({ grey: 240, alpha: 255, count: 4 }))).toBe('light')
    expect(toneOfPixels(pixels({ grey: 128, alpha: 255, count: 4 }))).toBe('mixed')
  })

  it('goes by the pixels that show, and calls a clear logo mixed', () => {
    const clearLight = pixels({ grey: 250, alpha: 0, count: 8 })
    expect(toneOfPixels([...clearLight, ...pixels({ grey: 10, alpha: 255, count: 1 })])).toBe(
      'dark',
    )
    expect(toneOfPixels(clearLight)).toBe('mixed')
  })
})

describe('logoTone', () => {
  it('leaves a logo it cannot read as drawn', () => {
    expect(logoTone(document.createElement('img'))).toBe('mixed')
  })
})
