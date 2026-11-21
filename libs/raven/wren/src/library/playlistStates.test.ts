import { describe, expect, it } from 'bun:test'

import { PLAYLIST_STATES, playlistsStateOf } from '@/library/playlistStates'

describe('playlistsStateOf', () => {
  it('offers the first playlist once the list is read', () => {
    expect(playlistsStateOf({ isSuccess: true })).toBe(PLAYLIST_STATES.empty)
  })

  it('says where the read stands until then', () => {
    expect(playlistsStateOf({ isSuccess: false })).toBe(PLAYLIST_STATES.notice)
  })
})
