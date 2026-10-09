import { describe, expect, it } from 'vitest'
import { isKnownLanguage, languageTag } from '@/tracks'

describe('languageTag', () => {
  it('folds three-letter codes, names and regions into one tag', () => {
    expect(['eng', 'en', 'English', 'en-US', 'EN_gb'].map(languageTag)).toEqual([
      'en',
      'en',
      'en',
      'en',
      'en',
    ])
    expect(languageTag('ger')).toBe('de')
    expect(languageTag('deu')).toBe('de')
  })

  it('treats undetermined as no language, and keeps unknown codes', () => {
    expect(languageTag('und')).toBeNull()
    expect(languageTag(null)).toBeNull()
    expect(languageTag('fil')).toBe('fil')
  })

  it('knows a language from a title word', () => {
    expect(isKnownLanguage('Japanese')).toBe(true)
    expect(isKnownLanguage('Commentary')).toBe(false)
  })
})
