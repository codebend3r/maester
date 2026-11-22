import { describe, expect, it } from 'bun:test'
import { isServerNamePick, serverNameEditOf } from '@/serverName'

describe('serverNameEditOf', () => {
  it('clears the name when the field is blank', () => {
    expect(serverNameEditOf('   ')).toEqual({ isRefused: false, serverName: null })
  })

  it('keeps a clean name, tidied', () => {
    expect(serverNameEditOf('  Living   room ')).toEqual({
      isRefused: false,
      serverName: 'Living room',
    })
  })

  it('refuses a name past the limit and one with a hidden character', () => {
    expect(serverNameEditOf('a'.repeat(81))).toEqual({ isRefused: true })
    expect(serverNameEditOf('Home‮')).toEqual({ isRefused: true })
  })
})

describe('isServerNamePick', () => {
  it('accepts a string or null only', () => {
    expect(isServerNamePick('Home')).toBe(true)
    expect(isServerNamePick(null)).toBe(true)
    expect(isServerNamePick(4)).toBe(false)
  })
})
