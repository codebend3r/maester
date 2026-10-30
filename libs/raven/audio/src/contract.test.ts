import { describe, expect, test } from 'bun:test'
import { REMOTE_COMMANDS } from '@raven/core'
import { AUDIO_PLAYER_EVENTS, isAudioPlayerEvent } from '@/contract'

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
    ]
    events.forEach((event) => expect(isAudioPlayerEvent(event)).toBe(true))
    expect(isAudioPlayerEvent({ type: AUDIO_PLAYER_EVENTS.state, position: '1' })).toBe(false)
    expect(isAudioPlayerEvent({ type: 'rewind' })).toBe(false)
  })
})
