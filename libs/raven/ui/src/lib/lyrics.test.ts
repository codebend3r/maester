import { describe, expect, it } from 'bun:test'
import { activeLineAt } from '@/lib/lyrics'

const LINES = [
  { at: 12, text: 'First' },
  { at: 15.5, text: 'Second' },
  { at: 20, text: 'Third' },
]

describe('activeLineAt', () => {
  it('is no line before the first is sung', () => {
    expect(activeLineAt({ lines: LINES, at: 0 })).toBeNull()
    expect(activeLineAt({ lines: LINES, at: 11.9 })).toBeNull()
  })

  it('is the last line to have started, from the moment it starts', () => {
    expect(activeLineAt({ lines: LINES, at: 12 })).toBe(0)
    expect(activeLineAt({ lines: LINES, at: 15.4 })).toBe(0)
    expect(activeLineAt({ lines: LINES, at: 15.5 })).toBe(1)
    expect(activeLineAt({ lines: LINES, at: 300 })).toBe(2)
  })

  it('is no line for lyrics with none', () => {
    expect(activeLineAt({ lines: [], at: 10 })).toBeNull()
  })
})
