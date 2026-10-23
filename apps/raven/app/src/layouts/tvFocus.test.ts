import { describe, expect, it } from 'bun:test'

import { requestTVFocus } from '@/layouts/tvFocus'

describe('requestTVFocus', () => {
  it("asks a view the fork gave its requestTVFocus for the remote's focus", () => {
    const asked: string[] = []
    requestTVFocus({ requestTVFocus: () => asked.push('card') })
    expect(asked).toEqual(['card'])
  })

  it('leaves anything else alone: no view yet, or one without the method', () => {
    expect(() => requestTVFocus(null)).not.toThrow()
    expect(() => requestTVFocus({ requestTVFocus: 'no' })).not.toThrow()
  })
})
