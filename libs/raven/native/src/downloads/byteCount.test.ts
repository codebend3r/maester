import { describe, expect, it } from 'bun:test'

import { byteCountOf } from '@/downloads/byteCount'

describe('byteCountOf', () => {
  it("reads a BigInt size, as Hermes hands iOS's Int64 over, as a plain number", () => {
    const bytes = byteCountOf(BigInt(4_200_000))
    expect(bytes).toBe(4_200_000)
    expect(typeof bytes).toBe('number')
    expect(JSON.stringify({ bytes })).toBe('{"bytes":4200000}')
  })

  it('keeps a number and refuses what is no count', () => {
    expect(byteCountOf(512)).toBe(512)
    expect(byteCountOf(Number.NaN)).toBeNull()
    expect(byteCountOf('512')).toBeNull()
    expect(byteCountOf(undefined)).toBeNull()
  })
})
