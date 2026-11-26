import { describe, expect, it } from 'bun:test'
import { NAME_SAVES, serverNameSaveOf } from '@/serverName'

describe('serverNameSaveOf', () => {
  it('keeps the name when the field is blank or holds it already', () => {
    expect(serverNameSaveOf({ text: '   ', current: 'Vhagar' })).toEqual({ kind: NAME_SAVES.kept })
    expect(serverNameSaveOf({ text: ' Vhagar ', current: 'Vhagar' })).toEqual({
      kind: NAME_SAVES.kept,
    })
  })

  it('saves a clean new name, tidied', () => {
    expect(serverNameSaveOf({ text: '  Living   room ', current: 'Vhagar' })).toEqual({
      kind: NAME_SAVES.saved,
      name: 'Living room',
    })
  })

  it('refuses a name past the limit and one with a hidden character', () => {
    expect(serverNameSaveOf({ text: 'a'.repeat(81), current: 'Vhagar' })).toEqual({
      kind: NAME_SAVES.refused,
    })
    expect(serverNameSaveOf({ text: 'Home‮', current: 'Vhagar' })).toEqual({
      kind: NAME_SAVES.refused,
    })
  })
})
