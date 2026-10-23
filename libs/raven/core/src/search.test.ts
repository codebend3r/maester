import { describe, expect, it } from 'bun:test'
import { SEARCH_DELAY_MS } from '@/search'

describe('SEARCH_DELAY_MS', () => {
  it("is the web's pause, a fifth of a second, which every raven search box waits for", () => {
    expect(SEARCH_DELAY_MS).toBe(200)
  })
})
