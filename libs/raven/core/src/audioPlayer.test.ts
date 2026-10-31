import { describe, expect, test } from 'bun:test'
import {
  ARTWORK_MAX_BYTES,
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  isAudioCommand,
  isAudioEvent,
  isAudioRequest,
  isNowPlayingInfo,
  isRemoteCommand,
  REMOTE_COMMANDS,
} from '@/audioPlayer'
import { EQ_PRESETS } from '@/equalizer'
import { PLAYER_ERROR_REASONS } from '@/player'

const INFO = { title: 'Blue', artist: 'Joni Mitchell', album: 'Blue', artwork: null }

describe('isAudioCommand', () => {
  test('accepts each command the page sends', () => {
    const commands = [
      { type: AUDIO_COMMANDS.load, mediaId: 7, next: 8, start: 0, kbps: null },
      { type: AUDIO_COMMANDS.load, mediaId: 7, next: null, start: 12.5, kbps: 256 },
      { type: AUDIO_COMMANDS.sound, level: 0.5, eq: EQ_PRESETS.flat },
      { type: AUDIO_COMMANDS.sound, level: 1, eq: EQ_PRESETS.bassBoost },
      { type: AUDIO_COMMANDS.queueNext, next: null },
      { type: AUDIO_COMMANDS.play },
      { type: AUDIO_COMMANDS.pause },
      { type: AUDIO_COMMANDS.seek, time: 3 },
      { type: AUDIO_COMMANDS.volume, volume: 0.5, muted: false },
      { type: AUDIO_COMMANDS.speed, rate: 1.5 },
      { type: AUDIO_COMMANDS.nowPlaying, info: INFO },
      { type: AUDIO_COMMANDS.nowPlaying, info: { ...INFO, artwork: new ArrayBuffer(8) } },
      { type: AUDIO_COMMANDS.stop },
    ]
    commands.forEach((command) => expect(isAudioCommand(command)).toBe(true))
  })

  test('rejects a track that is not a media id, a bitrate not offered, a level or band out of range, a cover past the cap, and the unknown', () => {
    const rejected = [
      { type: AUDIO_COMMANDS.load, mediaId: 0, next: null, start: 0, kbps: null },
      { type: AUDIO_COMMANDS.load, mediaId: '7', next: null, start: 0, kbps: null },
      { type: AUDIO_COMMANDS.load, mediaId: 7, next: null, start: 0, kbps: 192 },
      { type: AUDIO_COMMANDS.load, mediaId: 7, next: null, start: 0 },
      { type: AUDIO_COMMANDS.sound, level: 0, eq: EQ_PRESETS.flat },
      { type: AUDIO_COMMANDS.sound, level: 1.5, eq: EQ_PRESETS.flat },
      { type: AUDIO_COMMANDS.sound, level: 1, eq: [0, 0, 0] },
      { type: AUDIO_COMMANDS.sound, level: 1, eq: [...EQ_PRESETS.flat.slice(1), 13] },
      { type: AUDIO_COMMANDS.queueNext, next: -1 },
      { type: AUDIO_COMMANDS.speed, rate: '1.5' },
      { type: AUDIO_COMMANDS.nowPlaying, info: { ...INFO, artwork: 'bytes' } },
      {
        type: AUDIO_COMMANDS.nowPlaying,
        info: { ...INFO, artwork: new ArrayBuffer(ARTWORK_MAX_BYTES + 1) },
      },
      { type: 'rewind' },
      null,
    ]
    rejected.forEach((command) => expect(isAudioCommand(command)).toBe(false))
    expect(isNowPlayingInfo({ ...INFO, artwork: new ArrayBuffer(ARTWORK_MAX_BYTES) })).toBe(true)
  })

  test('a request is a command under a numeric id', () => {
    expect(isAudioRequest({ id: 1, command: { type: AUDIO_COMMANDS.play } })).toBe(true)
    expect(isAudioRequest({ id: '1', command: { type: AUDIO_COMMANDS.play } })).toBe(false)
    expect(isAudioRequest({ id: 1, command: { type: 'rewind' } })).toBe(false)
  })
})

describe('isAudioEvent', () => {
  test('accepts each event main sends, remote commands included', () => {
    const events = [
      { type: AUDIO_EVENTS.time, time: 1 },
      { type: AUDIO_EVENTS.duration, duration: null },
      { type: AUDIO_EVENTS.duration, duration: 200 },
      { type: AUDIO_EVENTS.paused, paused: true },
      { type: AUDIO_EVENTS.waiting, waiting: false },
      { type: AUDIO_EVENTS.advanced },
      { type: AUDIO_EVENTS.ended },
      { type: AUDIO_EVENTS.error, reason: PLAYER_ERROR_REASONS.engine, message: 'gone' },
      { type: AUDIO_EVENTS.remote, command: { kind: REMOTE_COMMANDS.toggle } },
      { type: AUDIO_EVENTS.remote, command: { kind: REMOTE_COMMANDS.seek, time: 4 } },
    ]
    events.forEach((event) => expect(isAudioEvent(event)).toBe(true))
  })

  test('rejects a seek without a time and a command it does not know', () => {
    expect(isRemoteCommand({ kind: REMOTE_COMMANDS.seek })).toBe(false)
    expect(isRemoteCommand({ kind: 'rewind' })).toBe(false)
    expect(isAudioEvent({ type: AUDIO_EVENTS.error, reason: 'tired', message: 'x' })).toBe(false)
  })
})
