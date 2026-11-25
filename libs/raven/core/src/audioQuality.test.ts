import { describe, expect, it } from 'bun:test'
import { audioQualityOf, qualityChipsOf } from '@/audioQuality'
import type { Track } from '@/contract/music'
import { AUDIO_BITRATES } from '@/contract/streaming'
import { AUDIO_CODECS } from '@/playback'
import { TRACK_STREAM_KINDS } from '@/trackStream'

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

describe('audioQualityOf', () => {
  it("says a lossless file's codec, bit depth, sample rate and bitrate", () => {
    expect(audioQualityOf({ track: AIRBAG, stream: FILE })).toEqual({
      format: 'FLAC',
      bitDepth: '16-bit',
      sampleRate: '44.1 kHz',
      bitrate: '912 kbps',
      isDownloaded: false,
    })
  })

  it("says a lossy file's codec and bitrate alone", () => {
    const mp3 = { ...AIRBAG, container: 'mp3', codec: 'mp3', isLossless: false, bitrate: 320_000 }
    expect(audioQualityOf({ track: mp3, stream: FILE })).toEqual({
      format: 'MP3',
      bitDepth: null,
      sampleRate: null,
      bitrate: '320 kbps',
      isDownloaded: false,
    })
  })

  it('names the container and leaves out what the server has not read yet', () => {
    const unread = { ...AIRBAG, codec: null, bitrate: null, sampleRate: null, bitDepth: null }
    expect(audioQualityOf({ track: unread, stream: FILE })).toEqual({
      format: 'FLAC',
      bitDepth: null,
      sampleRate: null,
      bitrate: null,
      isDownloaded: false,
    })
  })

  it('says the transcode that plays, not the file it was made from', () => {
    const stream = { kind: TRACK_STREAM_KINDS.transcode, kbps: AUDIO_BITRATES.standard } as const
    expect(audioQualityOf({ track: AIRBAG, stream })).toEqual({
      format: 'AAC',
      bitDepth: null,
      sampleRate: null,
      bitrate: '256 kbps',
      isDownloaded: false,
    })
  })

  it('says a download at the bitrate it was made at', () => {
    const stream = { kind: TRACK_STREAM_KINDS.download, kbps: AUDIO_BITRATES.high } as const
    expect(audioQualityOf({ track: AIRBAG, stream })).toMatchObject({
      format: 'AAC',
      bitrate: '320 kbps',
      isDownloaded: true,
    })
  })
})

describe('qualityChipsOf', () => {
  it('is the format, then the bit depth when the file has one', () => {
    expect(qualityChipsOf(audioQualityOf({ track: AIRBAG, stream: FILE }))).toEqual([
      'FLAC',
      '16-bit',
    ])
    const stream = { kind: TRACK_STREAM_KINDS.transcode, kbps: AUDIO_BITRATES.standard } as const
    expect(qualityChipsOf(audioQualityOf({ track: AIRBAG, stream }))).toEqual(['AAC'])
  })
})
