import { describe, expect, test } from 'bun:test'
import { REMOTE_COMMANDS } from '@raven/core'
import { AUDIO_PLAYER_EVENTS, BROWSE_ROOTS, isAudioPlayerEvent, isBrowseNode } from '@/contract'

describe('the audio contract', () => {
  test('accepts each event the native player sends, and refuses the rest', () => {
    const events = [
      {
        type: AUDIO_PLAYER_EVENTS.state,
        position: 1,
        duration: null,
        isPlaying: true,
        isBuffering: false,
      },
      { type: AUDIO_PLAYER_EVENTS.advanced },
      { type: AUDIO_PLAYER_EVENTS.ended },
      { type: AUDIO_PLAYER_EVENTS.error, message: 'no' },
      { type: AUDIO_PLAYER_EVENTS.remote, command: { kind: REMOTE_COMMANDS.next } },
      { type: AUDIO_PLAYER_EVENTS.remote, command: { kind: REMOTE_COMMANDS.seek, time: 3 } },
      { type: AUDIO_PLAYER_EVENTS.browse, requestId: 'r1', parentId: BROWSE_ROOTS.home },
      { type: AUDIO_PLAYER_EVENTS.playFromBrowse, id: 'album:3' },
    ]
    events.forEach((event) => expect(isAudioPlayerEvent(event)).toBe(true))
    expect(isAudioPlayerEvent({ type: AUDIO_PLAYER_EVENTS.state, position: '1' })).toBe(false)
    expect(isAudioPlayerEvent({ type: 'rewind' })).toBe(false)
    expect(isAudioPlayerEvent({ type: AUDIO_PLAYER_EVENTS.browse, requestId: 'r1' })).toBe(false)
    expect(isAudioPlayerEvent({ type: AUDIO_PLAYER_EVENTS.playFromBrowse, id: 3 })).toBe(false)
  })

  test('accepts a browse node, folder or playable, and refuses one missing a field', () => {
    const folder = {
      id: BROWSE_ROOTS.albums,
      title: 'Albums',
      subtitle: null,
      artworkUri: null,
      isPlayable: false,
    }
    const album = {
      id: 'album:3',
      title: 'OK Computer',
      subtitle: 'Radiohead',
      artworkUri: 'https://raven.example/api/pictures/albums/3/v1',
      isPlayable: true,
    }
    expect(isBrowseNode(folder)).toBe(true)
    expect(isBrowseNode(album)).toBe(true)
    expect(isBrowseNode({ ...album, isPlayable: undefined })).toBe(false)
    expect(isBrowseNode({ ...album, subtitle: 3 })).toBe(false)
  })
})
