import { describe, expect, it } from 'bun:test'

import { isSameDrawing } from '@/layouts/sameDrawing'

describe('isSameDrawing', () => {
  it('takes fresh objects alike in every field as the same', () => {
    expect(
      isSameDrawing({ card: { key: 'a', progress: 0.5 } }, { card: { key: 'a', progress: 0.5 } }),
    ).toBe(true)
  })

  it('takes any two callbacks as the same', () => {
    expect(isSameDrawing({ onPress: () => 1 }, { onPress: () => 2 })).toBe(true)
  })

  it('draws again when data changes', () => {
    expect(
      isSameDrawing({ card: { key: 'a', progress: 0.5 } }, { card: { key: 'a', progress: 0.6 } }),
    ).toBe(false)
    expect(isSameDrawing({ isPreferred: true }, { isPreferred: false })).toBe(false)
  })

  it('draws again when a prop comes or goes', () => {
    expect(isSameDrawing<{ ratio?: number }>({}, { ratio: 1 })).toBe(false)
  })

  it('draws again when a callback gives way to data', () => {
    expect(isSameDrawing<{ jump: unknown }>({ jump: () => 1 }, { jump: null })).toBe(false)
  })
})
