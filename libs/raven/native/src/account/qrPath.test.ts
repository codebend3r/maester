import { describe, expect, it } from 'bun:test'

import { qrDrawingOf } from '@/account/qrPath'

describe('qrDrawingOf', () => {
  it('draws a square of modules with the finder pattern in its corner', () => {
    const { size, path } = qrDrawingOf('https://raven.example/link?code=BCDF-GHJK')
    // Version 1 is 21 modules a side and every version adds four.
    expect((size - 21) % 4).toBe(0)
    // The finder's top edge: seven dark modules from the corner, then a light one.
    expect(path.startsWith('M0 0h1v1h-1zM1 0h1v1h-1z')).toBe(true)
    expect(path).toContain('M6 0h1v1h-1z')
    expect(path).not.toContain('M7 0h1v1h-1z')
  })

  it('draws a longer value as a larger code', () => {
    expect(qrDrawingOf('a'.repeat(200)).size).toBeGreaterThan(qrDrawingOf('a').size)
  })
})
