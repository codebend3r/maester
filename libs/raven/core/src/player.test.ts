import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_OUTPUT_SETTINGS,
  isOutputSettings,
  isPassthroughFormat,
  isPlayerCommand,
  isPlayerErrorReason,
  isPlayerEvent,
  isPlayerReply,
  isPlayerRequest,
  isPlayerSource,
} from '@/player'

const tracks = { audio: [], subtitles: [], defaultAudio: null, frameRate: null }

const valid = {
  sources: [
    { kind: 'server', serverId: 'vhagar', mediaId: 42 },
    { kind: 'file', fileId: 'f1' },
  ],
  commands: [
    { type: 'load', source: { kind: 'file', fileId: 'f1' }, start: 0, audio: null, subtitle: null },
    { type: 'play' },
    { type: 'pause' },
    { type: 'seek', time: 12.5 },
    { type: 'audio', index: 1 },
    { type: 'subtitle', id: 'embedded-0' },
    { type: 'volume', volume: 0.5, muted: false },
    { type: 'speed', rate: 1.5 },
    { type: 'subtitleScale', scale: 1.2 },
    { type: 'stats' },
    { type: 'stop' },
  ],
  events: [
    { type: 'time', time: 3 },
    { type: 'buffered', ranges: [{ start: 0, end: 10 }] },
    { type: 'paused', paused: true },
    { type: 'waiting', waiting: false },
    { type: 'duration', duration: null },
    { type: 'rate', rate: 1 },
    { type: 'tracks', tracks },
    { type: 'ended' },
    { type: 'error', reason: 'decode', message: 'bad frame' },
  ],
}

const load = {
  type: 'load',
  source: { kind: 'file', fileId: 'f1' },
  start: 0,
  audio: null,
  subtitle: null,
}

describe('isPlayerSource', () => {
  it.each(valid.sources)('accepts %o', (source) => {
    expect(isPlayerSource(source)).toBe(true)
  })

  it.each([
    { kind: 'path', path: '/etc/hosts' },
    { kind: 'server', serverId: 'v', mediaId: '42' },
    { kind: 'file' },
  ])('rejects %o', (source) => {
    expect(isPlayerSource(source)).toBe(false)
  })
})

describe('isPlayerCommand', () => {
  it.each(valid.commands)('accepts %o', (command) => {
    expect(isPlayerCommand(command)).toBe(true)
  })

  it.each([
    { type: 'run', args: [] },
    { type: 'loadfile', url: 'https://x' },
    { ...load, start: '0' },
    { ...load, audio: '1' },
    { ...load, subtitle: 3 },
    { ...load, source: { kind: 'url', url: 'x' } },
    { type: 'seek', time: Number.NaN },
    { type: 'seek', time: Infinity },
    { type: 'volume', volume: 0.5, muted: 'no' },
  ])('rejects %o', (command) => {
    expect(isPlayerCommand(command)).toBe(false)
  })
})

describe('isPlayerEvent', () => {
  it.each(valid.events)('accepts %o', (event) => {
    expect(isPlayerEvent(event)).toBe(true)
  })

  it.each([
    { type: 'error', reason: 'crash', message: 'x' },
    { type: 'tracks', tracks: { audio: 'x' } },
    { type: 'buffered', ranges: [{ start: 0 }] },
  ])('rejects %o', (event) => {
    expect(isPlayerEvent(event)).toBe(false)
  })
})

describe('isPlayerErrorReason', () => {
  it('lists every reason', () => {
    expect(isPlayerErrorReason.values).toEqual(['open', 'decode', 'network', 'locked', 'engine'])
  })
})

describe('isPlayerRequest', () => {
  it('accepts a command with a numeric id', () => {
    expect(isPlayerRequest({ id: 1, command: { type: 'play' } })).toBe(true)
  })

  it('rejects a string id', () => {
    expect(isPlayerRequest({ id: '1', command: { type: 'play' } })).toBe(false)
  })

  it('rejects an unknown command', () => {
    expect(isPlayerRequest({ id: 1, command: { type: 'nope' } })).toBe(false)
  })
})

describe('isPlayerReply', () => {
  it('accepts a success', () => {
    expect(isPlayerReply({ id: 1, ok: true })).toBe(true)
  })

  it('accepts a failure with a known reason and its message, and nothing less', () => {
    expect(isPlayerReply({ id: 1, ok: false, reason: 'refused', message: 'x' })).toBe(true)
    expect(isPlayerReply({ id: 1, ok: false, reason: 'engine', message: 'x' })).toBe(true)
    expect(isPlayerReply({ id: 1, ok: false, message: 'x' })).toBe(false)
    expect(isPlayerReply({ id: 1, ok: false, reason: 'gone', message: 'x' })).toBe(false)
  })

  it('rejects a failure without a message', () => {
    expect(isPlayerReply({ id: 1, ok: false })).toBe(false)
  })

  it('rejects a non-boolean ok', () => {
    expect(isPlayerReply({ id: 1, ok: 'yes' })).toBe(false)
  })
})

describe('isOutputSettings', () => {
  const headphones = {
    profile: 'headphones',
    device: 'coreaudio/BuiltInSpeakerDevice',
    passthrough: [],
    spatial: true,
  }

  it('accepts the defaults and a headphones profile', () => {
    expect(isOutputSettings(DEFAULT_OUTPUT_SETTINGS)).toBe(true)
    expect(isOutputSettings(headphones)).toBe(true)
  })

  it('rejects an unknown profile', () => {
    expect(isOutputSettings({ ...headphones, profile: 'bitstream' })).toBe(false)
  })

  it('rejects an unknown passthrough format', () => {
    expect(isOutputSettings({ ...headphones, passthrough: ['mp3'] })).toBe(false)
  })

  it('rejects a numeric device', () => {
    expect(isOutputSettings({ ...headphones, device: 3 })).toBe(false)
  })

  it('rejects a missing spatial', () => {
    const { spatial: _spatial, ...rest } = headphones
    expect(isOutputSettings(rest)).toBe(false)
  })

  it('lists the passthrough formats in mpv order', () => {
    expect(isPassthroughFormat.values).toEqual(['ac3', 'eac3', 'dts', 'dts-hd', 'truehd'])
  })
})
