import { describe, expect, it } from 'bun:test'
import { type AudioTrack, SUBTITLE_SOURCES, type SubtitleTrack } from '@/contract'
import { audioLabel, subtitleLabel } from '@/trackLabels'

const audio = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  index: 0,
  codec: 'eac3',
  channels: 6,
  language: 'en',
  title: null,
  default: true,
  ...overrides,
})

const subtitle = (overrides: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  id: 'external-0',
  source: SUBTITLE_SOURCES.external,
  codec: 'srt',
  language: 'en',
  title: null,
  default: false,
  forced: true,
  hearingImpaired: false,
  supported: true,
  ...overrides,
})

describe('audioLabel', () => {
  it('names an English 5.1 E-AC-3 track by language, with its codec and channels', () => {
    expect(audioLabel(audio())).toEqual({ name: 'English', details: 'Dolby Digital Plus · 5.1' })
  })

  it('falls back to the track number when the language is untagged', () => {
    expect(audioLabel(audio({ index: 1, language: null })).name).toBe('Track 2')
  })
})

describe('subtitleLabel', () => {
  it('names a forced sidecar track by language, marked Forced and File', () => {
    expect(subtitleLabel(subtitle())).toEqual({ name: 'English', details: 'Forced · File' })
  })

  it("says why a picture track can't be shown", () => {
    expect(
      subtitleLabel(
        subtitle({
          source: SUBTITLE_SOURCES.embedded,
          forced: false,
          hearingImpaired: true,
          supported: false,
        }),
      ).details,
    ).toBe("SDH · Picture subtitles, can't be shown")
  })
})
