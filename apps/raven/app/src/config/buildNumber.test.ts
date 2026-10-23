import { describe, expect, it } from 'bun:test'

import { buildNumberOf } from '@/config/buildNumber'

describe('buildNumberOf', () => {
  it('reads the CI run number', () => {
    expect(buildNumberOf({ runNumber: '42' })).toBe(42)
    expect(buildNumberOf({ runNumber: ' 7 ' })).toBe(7)
  })

  it('counts a build without a usable run number as the first', () => {
    expect(
      [undefined, '', '0', '-3', '1.5', '08', 'seven'].map((runNumber) =>
        buildNumberOf({ runNumber }),
      ),
    ).toEqual([1, 1, 1, 1, 1, 1, 1])
  })
})
