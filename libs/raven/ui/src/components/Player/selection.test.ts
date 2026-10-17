import { describe, expect, it } from 'bun:test'
import type { MediaTracks, SubtitleTrack } from '@raven/core'
import { playingAudio, preferredAudio, preferredSubtitle } from '@/components/Player/selection'

const subtitle = (overrides: Partial<SubtitleTrack>): SubtitleTrack => ({
  id: 'embedded-0',
  source: 'embedded',
  codec: 'subrip',
  language: 'en',
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...overrides,
})

const tracks: MediaTracks = {
  audio: [
    { index: 0, codec: 'eac3', channels: 6, language: 'en', title: null, default: true },
    { index: 1, codec: 'aac', channels: 2, language: 'ja', title: null, default: false },
  ],
  subtitles: [
    subtitle({ id: 'embedded-0', forced: true }),
    subtitle({ id: 'embedded-1' }),
    subtitle({ id: 'embedded-2', language: 'ja', supported: false }),
    subtitle({ id: 'external-0', source: 'external', language: 'ja' }),
  ],
  defaultAudio: 0,
  frameRate: 24,
}

describe('preferredAudio', () => {
  it('keeps the default unless another language was picked and is here', () => {
    expect(preferredAudio({ tracks, language: null })).toBeNull()
    expect(preferredAudio({ tracks, language: 'en' })).toBeNull()
    expect(preferredAudio({ tracks, language: 'ja' })).toBe(1)
    expect(preferredAudio({ tracks, language: 'fr' })).toBeNull()
    expect(preferredAudio({ tracks: null, language: 'ja' })).toBeNull()
  })
})

describe('preferredSubtitle', () => {
  it('stays off when subtitles were off', () => {
    expect(preferredSubtitle({ tracks, subtitles: { on: false, language: 'en' } })).toBeNull()
  })

  it('prefers a full track in the remembered language over a forced one', () => {
    expect(preferredSubtitle({ tracks, subtitles: { on: true, language: 'en' } })).toBe(
      'embedded-1',
    )
  })

  it('skips picture tracks, and takes any showable one without a language', () => {
    expect(preferredSubtitle({ tracks, subtitles: { on: true, language: 'ja' } })).toBe(
      'external-0',
    )
    expect(preferredSubtitle({ tracks, subtitles: { on: true, language: null } })).toBe(
      'embedded-1',
    )
    expect(preferredSubtitle({ tracks, subtitles: { on: true, language: 'fr' } })).toBeNull()
  })
})

describe('playingAudio', () => {
  it('plays the picked track on a converted stream, else the default', () => {
    expect(playingAudio({ mode: 'remux', tracks, audio: 1 })).toBe(1)
    expect(playingAudio({ mode: 'transcode', tracks, audio: null })).toBe(0)
    expect(playingAudio({ mode: 'remux', tracks: null, audio: null })).toBeNull()
  })

  it("plays the file's own default in direct play, whichever was picked", () => {
    expect(playingAudio({ mode: 'direct', tracks, audio: 1 })).toBe(0)
    expect(playingAudio({ mode: 'direct', tracks: null, audio: 1 })).toBeNull()
  })
})
