import { describe, expect, it } from 'bun:test'
import { NAME_MAX, cleanName } from '@/names'

describe('cleanName', () => {
  it('trims and collapses inner whitespace to one space', () => {
    expect(cleanName('  Vhagar   NAS ')).toBe('Vhagar NAS')
  })

  it('collapses tabs and line breaks too', () => {
    expect(cleanName('Vhagar\t\n NAS')).toBe('Vhagar NAS')
  })

  it('is null for an empty or blank name', () => {
    expect(cleanName('')).toBeNull()
    expect(cleanName('   ')).toBeNull()
  })

  it('accepts exactly NAME_MAX characters and refuses one more', () => {
    expect(cleanName('a'.repeat(NAME_MAX))).toBe('a'.repeat(NAME_MAX))
    expect(cleanName('a'.repeat(NAME_MAX + 1))).toBeNull()
    expect(NAME_MAX).toBe(80)
  })

  it('measures the cleaned name, not the raw one', () => {
    expect(cleanName(`  ${'a'.repeat(NAME_MAX)}  `)).toBe('a'.repeat(NAME_MAX))
  })

  it('is null for a format character, a bidi override or a zero width', () => {
    expect(cleanName('a\u202eb')).toBeNull()
    expect(cleanName('a\u200bb')).toBeNull()
    expect(cleanName('a\u2066b')).toBeNull()
  })

  it('keeps the joiners an emoji or a script needs', () => {
    expect(cleanName('\u{1F468}\u200d\u{1F469}\u200d\u{1F467} Home')).toBe(
      '\u{1F468}\u200d\u{1F469}\u200d\u{1F467} Home',
    )
    expect(cleanName('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645')).toBe(
      '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645',
    )
  })

  it('keeps the tag characters of a subdivision flag', () => {
    const scotland = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'
    expect(cleanName(`${scotland} NAS`)).toBe(`${scotland} NAS`)
  })

  it('counts a name by code points, so 80 astral characters fit and 81 do not', () => {
    expect(cleanName('\u{1F985}'.repeat(NAME_MAX))).toBe('\u{1F985}'.repeat(NAME_MAX))
    expect(cleanName('\u{1F985}'.repeat(NAME_MAX + 1))).toBeNull()
  })

  it('is null for a control character', () => {
    expect(cleanName('a\u0007b')).toBeNull()
    expect(cleanName('a\u0000b')).toBeNull()
  })
})
