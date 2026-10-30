import { describe, expect, it } from 'bun:test'

import { typedFrom } from '@/voice/spokenText'

describe('typedFrom', () => {
  it('spells out an address said as words', () => {
    expect(typedFrom({ heard: 'Pat Smith at Example dot com', isEmail: true })).toBe(
      'patsmith@example.com',
    )
  })

  it('closes up an address the recognizer already wrote', () => {
    expect(typedFrom({ heard: 'pat@example.com ', isEmail: true })).toBe('pat@example.com')
  })

  it('keeps the case of a password and drops the spaces between its pieces', () => {
    expect(typedFrom({ heard: 'Hunter 2 at home', isEmail: false })).toBe('Hunter2athome')
  })
})
