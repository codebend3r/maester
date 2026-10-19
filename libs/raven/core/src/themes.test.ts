import { describe, expect, it } from 'bun:test'
import { isThemeId, themeOf } from '@/themes'

describe('THEMES', () => {
  it('knows its ids and nothing else', () => {
    expect(isThemeId('patina')).toBe(true)
    expect(isThemeId('sepia')).toBe(false)
    expect(isThemeId(null)).toBe(false)
    expect(themeOf('mint').name).toBe('Mint')
  })
})
