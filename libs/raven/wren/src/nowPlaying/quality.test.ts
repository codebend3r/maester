import { describe, expect, it } from 'bun:test'
import { AUDIO_BITRATES, AUDIO_CODECS, TRACK_STREAM_KINDS, type Track } from '@raven/core'

import { qualityLineOf } from '@/nowPlaying/quality'

const AIRBAG: Track = {
  id: 101,
  libraryId: 5,
  albumId: 7,
  title: 'Airbag',
  disc: 1,
  number: 1,
  duration: 284,
  artists: [{ id: 1, name: 'Radiohead' }],
  container: 'flac',
  codec: AUDIO_CODECS.flac,
  bitrate: 912_400,
  sampleRate: 44_100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
}

const FILE = { kind: TRACK_STREAM_KINDS.file } as const

describe('qualityLineOf', () => {
  it("says a lossless file's codec, resolution and bitrate", () => {
    expect(qualityLineOf({ track: AIRBAG, stream: FILE })).toBe(
      'FLAC · 16-bit / 44.1 kHz · 912 kbps',
    )
  })

  it("says a lossy file's codec and bitrate alone", () => {
    const mp3 = { ...AIRBAG, container: 'mp3', codec: 'mp3', isLossless: false, bitrate: 320_000 }
    expect(qualityLineOf({ track: mp3, stream: FILE })).toBe('MP3 · 320 kbps')
  })

  it('names the container and leaves out what the server has not read yet', () => {
    const unread = { ...AIRBAG, codec: null, bitrate: null, sampleRate: null, bitDepth: null }
    expect(qualityLineOf({ track: unread, stream: FILE })).toBe('FLAC')
  })

  it('says the transcode that plays, not the file it was made from', () => {
    const stream = { kind: TRACK_STREAM_KINDS.transcode, kbps: AUDIO_BITRATES.standard } as const
    expect(qualityLineOf({ track: AIRBAG, stream })).toBe('AAC · 256 kbps')
  })

  it('says a download at the bitrate it was made at', () => {
    const stream = { kind: TRACK_STREAM_KINDS.download, kbps: AUDIO_BITRATES.high } as const
    expect(qualityLineOf({ track: AIRBAG, stream })).toBe('AAC · 320 kbps · Downloaded')
  })
})
