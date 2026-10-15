import { describe, expect, it } from 'bun:test'
import { languageName } from '@/languageName'

describe('languageName', () => {
  it('names valid tags and leaves absent languages for the caller to label', () => {
    expect(languageName({ tag: 'en' })).toBe('English')
    expect(languageName({ tag: 'fr', fallback: 'original' })).toBe('French')
    expect(languageName({ tag: null })).toBeNull()
    expect(languageName({ tag: null, fallback: 'original' })).toBeNull()
  })

  it('preserves track and image fallback spelling for invalid tags', () => {
    expect(languageName({ tag: 'not_a_tag' })).toBe('NOT_A_TAG')
    expect(languageName({ tag: 'not_a_tag', fallback: 'original' })).toBe('not_a_tag')
  })
})
