import { describe, expect, it } from 'bun:test'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  TRACK_STREAM_KINDS,
  type Track,
  type TrackStream,
  audioQualityOf,
} from '@raven/core'

import { KIT_COPY } from '@/copy/kit'
import { NOW_PLAYING_COPY } from '@/copy/screens'
import { qualityViewOf } from '@/nowPlaying/quality'

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

const MP3: Track = {
  ...AIRBAG,
  container: 'mp3',
  codec: 'mp3',
  isLossless: false,
  bitrate: 320_000,
}

const UNREAD: Track = { ...AIRBAG, codec: null, bitrate: null, sampleRate: null, bitDepth: null }

const FILE: TrackStream = { kind: TRACK_STREAM_KINDS.file }

const TRANSCODE: TrackStream = {
  kind: TRACK_STREAM_KINDS.transcode,
  kbps: AUDIO_BITRATES.standard,
}

const DOWNLOAD: TrackStream = { kind: TRACK_STREAM_KINDS.download, kbps: AUDIO_BITRATES.high }

type ViewOfProps = { track: Track; stream: TrackStream }

const viewOf = ({ track, stream }: ViewOfProps) => qualityViewOf(audioQualityOf({ track, stream }))

const spoken = (line: string) => KIT_COPY.labelled({ label: NOW_PLAYING_COPY.quality, value: line })

describe('qualityViewOf', () => {
  it("draws a lossless file's format and bit depth as chips, then its sample rate and bitrate", () => {
    expect(viewOf({ track: AIRBAG, stream: FILE })).toEqual({
      chips: ['FLAC', '16-bit'],
      facts: '44.1 kHz · 912 kbps',
      label: spoken('FLAC · 16-bit / 44.1 kHz · 912 kbps'),
    })
  })

  it("draws a lossy file's codec as its one chip, then its bitrate alone", () => {
    expect(viewOf({ track: MP3, stream: FILE })).toEqual({
      chips: ['MP3'],
      facts: '320 kbps',
      label: spoken('MP3 · 320 kbps'),
    })
  })

  it('names the container and says nothing after it for a file the server has not read yet', () => {
    expect(viewOf({ track: UNREAD, stream: FILE })).toEqual({
      chips: ['FLAC'],
      facts: null,
      label: spoken('FLAC'),
    })
  })

  it('says the transcode that plays, not the file it was made from', () => {
    expect(viewOf({ track: AIRBAG, stream: TRANSCODE })).toEqual({
      chips: ['AAC'],
      facts: '256 kbps',
      label: spoken('AAC · 256 kbps'),
    })
  })

  it('says that a download is one, after the bitrate it was made at', () => {
    expect(viewOf({ track: AIRBAG, stream: DOWNLOAD })).toEqual({
      chips: ['AAC'],
      facts: '320 kbps · Downloaded',
      label: spoken('AAC · 320 kbps · Downloaded'),
    })
  })
})
