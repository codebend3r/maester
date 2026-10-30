import { describe, expect, it } from 'bun:test'

import { lineScrollOf } from '@/layouts/lineInView'

describe('lineScrollOf', () => {
  it("puts the line in the box's middle", () => {
    expect(lineScrollOf({ y: 400, height: 20, box: 200 })).toBe(310)
  })

  it('never scrolls above the top for the first lines', () => {
    expect(lineScrollOf({ y: 20, height: 20, box: 200 })).toBe(0)
  })
})
