import { describe, expect, it } from 'bun:test'
import { type MediaTracks, PLAYBACK_MODES, type SubtitleTrack } from '@raven/core'
import {
  aboutLine,
  audioPillLabel,
  endsAtLabel,
  pictureLabel,
  qualityLabel,
  stepDownNote,
  subtitlePillLabel,
} from '@/components/Player/playbackFacts'
import { mediaItem } from '@/test/fixtures'

const TRACKS: MediaTracks = {
  audio: [
    { index: 0, codec: 'truehd', channels: 8, language: 'en', title: null, default: true },
    { index: 1, codec: 'aac', channels: 2, language: null, title: 'Commentary', default: false },
  ],
  subtitles: [],
  defaultAudio: 0,
  frameRate: 24,
}

const SUBTITLE: SubtitleTrack = {
  id: 'embedded-0',
  source: 'embedded',
  codec: 'subrip',
  language: 'fr',
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
}

const uhd = mediaItem({ width: 3840, height: 2076, hdr: true })

describe('pictureLabel', () => {
  it('names the resolution, with HDR when the file has it', () => {
    expect(pictureLabel(uhd)).toBe('4K HDR')
    expect(pictureLabel(mediaItem())).toBe('1080p')
    expect(pictureLabel(mediaItem({ width: null, height: null }))).toBeNull()
  })
})

describe('aboutLine', () => {
  it('gives the year, the picture and how it plays', () => {
    expect(aboutLine({ media: { ...uhd, year: 2019 }, label: 'Abominable', mode: 'direct' })).toBe(
      '2019 · 4K HDR · Direct play',
    )
  })

  it('takes a matched item’s year, and leaves it out when the title ends with it', () => {
    const matched = mediaItem({
      item: {
        id: 3,
        type: 'movie',
        title: 'Abominable',
        year: 2019,
        show: null,
        season: null,
        episode: null,
        posterVersion: null,
        backdropVersion: null,
        ratings: [],
      },
    })
    expect(aboutLine({ media: matched, label: 'Abominable', mode: 'remux' })).toBe(
      '2019 · 1080p · Audio converted',
    )
    expect(aboutLine({ media: matched, label: 'Abominable (2019)', mode: 'transcode' })).toBe(
      '1080p · Converted',
    )
  })

  it('says only how a local file plays', () => {
    expect(aboutLine({ media: null, label: 'clip.mp4', mode: 'direct' })).toBe('Direct play')
  })

  it('puts where the title came from first, when the host names it', () => {
    expect(
      aboutLine({
        media: null,
        label: 'S01E01 Good News',
        mode: 'direct',
        context: 'Downloaded from Vhagar',
      }),
    ).toBe('Downloaded from Vhagar · Direct play')
    expect(
      aboutLine({
        media: { ...uhd, year: 2019 },
        label: 'Abominable',
        mode: 'direct',
        context: 'Downloaded from Vhagar',
      }),
    ).toBe('Downloaded from Vhagar · 2019 · 4K HDR · Direct play')
    expect(aboutLine({ media: null, label: 'clip.mp4', mode: 'direct', context: null })).toBe(
      'Direct play',
    )
  })
})

describe('qualityLabel', () => {
  it('names the picture while it reaches the screen untouched', () => {
    expect(qualityLabel({ media: uhd, mode: 'direct' })).toBe('4K · Direct play')
    expect(qualityLabel({ media: uhd, mode: 'remux' })).toBe('4K · Audio converted')
  })

  it('leaves the size of a conversion, and of an unknown file, unsaid', () => {
    expect(qualityLabel({ media: uhd, mode: 'transcode' })).toBe('Converted')
    expect(qualityLabel({ media: null, mode: 'direct' })).toBe('Direct play')
  })
})

describe('the audio pill', () => {
  it('reads the file’s own default under direct play, whichever was picked', () => {
    expect(audioPillLabel({ mode: 'direct', tracks: TRACKS, audio: 1 })).toBe('English 7.1')
  })

  it('reads the picked track once the server converts', () => {
    expect(audioPillLabel({ mode: 'remux', tracks: TRACKS, audio: 1 })).toBe('Track 2 Stereo')
    expect(audioPillLabel({ mode: 'remux', tracks: TRACKS, audio: null })).toBe('English 7.1')
  })

  it('says nothing until the tracks are read', () => {
    expect(audioPillLabel({ mode: 'direct', tracks: null, audio: null })).toBeNull()
  })
})

describe('subtitlePillLabel', () => {
  it('names the language showing, or Off', () => {
    expect(subtitlePillLabel(SUBTITLE)).toBe('French')
    expect(subtitlePillLabel(null)).toBe('Off')
  })
})

describe('stepDownNote', () => {
  it('says what the connection carried against what the stream needed', () => {
    expect(
      stepDownNote({
        from: PLAYBACK_MODES.remux,
        delivery: { delivered: 39_200_000, needed: 69_800_000 },
      }),
    ).toBe(
      'Switched to a transcode because the connection carried 39.2 Mb/s and the remux needs 69.8 Mb/s.',
    )
  })

  it('names only what was carried when the need is unknown', () => {
    expect(
      stepDownNote({ from: PLAYBACK_MODES.remux, delivery: { delivered: 800_000, needed: null } }),
    ).toBe('Switched to a transcode because the connection carried only 800 kb/s.')
  })
})

describe('endsAtLabel', () => {
  // 1:00 AM local time, formatted in the same zone.
  const now = new Date(2026, 9, 19, 1, 0).getTime()
  const at = (overrides: Partial<Parameters<typeof endsAtLabel>[0]>) =>
    endsAtLabel({ now, time: 0, duration: 80 * 60, rate: 1, locale: 'en-US', ...overrides })

  it('names the clock time the video ends', () => {
    expect(at({})).toBe('Ends at 2:20 AM')
    expect(at({ time: 20 * 60 })).toBe('Ends at 2:00 AM')
  })

  it('counts the speed', () => {
    expect(at({ rate: 2 })).toBe('Ends at 1:40 AM')
  })

  it('says nothing while the length is unknown', () => {
    expect(at({ duration: null })).toBeNull()
  })
})
