import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES, type MediaTracks, PLAYBACK_MODES, type SubtitleTrack } from '@raven/core'
import {
  aboutLine,
  headerTitleOf,
  playingCodec,
  playingRange,
  playingResolution,
  audioPillLabel,
  endsAtLabel,
  pictureLabel,
  qualityLabel,
  stepDownNote,
  subtitlePillLabel,
} from '@/components/Player/playbackFacts'
import { itemSummary, mediaItem } from '@/test/fixtures'

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
  it('gives the year alone, since the picture has chips of its own', () => {
    expect(aboutLine({ media: { ...uhd, year: 2019 }, label: 'Abominable' })).toBe('2019')
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
        released: null,
      },
    })
    expect(aboutLine({ media: matched, label: 'Abominable' })).toBe('2019')
    expect(aboutLine({ media: matched, label: 'Abominable (2019)' })).toBe('')
  })

  it('says nothing of a local file', () => {
    expect(aboutLine({ media: null, label: 'clip.mp4' })).toBe('')
  })

  it('puts where the title came from first, when the host names it', () => {
    expect(
      aboutLine({
        media: null,
        label: 'S01E01 Good News',
        context: 'Downloaded from Vhagar',
      }),
    ).toBe('Downloaded from Vhagar')
    expect(
      aboutLine({
        media: { ...uhd, year: 2019 },
        label: 'Abominable',
        context: 'Downloaded from Vhagar',
      }),
    ).toBe('Downloaded from Vhagar · 2019')
    expect(aboutLine({ media: null, label: 'clip.mp4', context: null })).toBe('')
  })
})

const halfLoop = mediaItem({
  item: itemSummary({
    type: ITEM_TYPES.episode,
    title: 'Half Loop',
    year: 2022,
    show: { id: 9, title: 'Severance' },
    season: 1,
    episode: 2,
  }),
})

describe('headerTitleOf', () => {
  it("heads an episode with its show's name and keeps its own title for the line under it", () => {
    expect(headerTitleOf({ media: halfLoop, label: 'Severance · S01E02 · Half Loop' })).toEqual({
      name: 'Severance',
      episode: 'Half Loop',
    })
  })

  it('keeps the label for a film or a local file, with no episode line', () => {
    expect(headerTitleOf({ media: uhd, label: 'Abominable (2019)' })).toEqual({
      name: 'Abominable (2019)',
      episode: null,
    })
    expect(headerTitleOf({ media: null, label: 'clip.mp4' })).toEqual({
      name: 'clip.mp4',
      episode: null,
    })
  })
})

describe('aboutLine, for an episode', () => {
  it('gives its season and number, the runtime, then the year', () => {
    expect(aboutLine({ media: halfLoop, label: 'Severance', duration: 2880 })).toBe(
      'S01 · E02 · 48m · 2022',
    )
  })
})

describe('playingCodec', () => {
  it("names the file's codec while the picture reaches the screen as the file has it", () => {
    expect(playingCodec({ media: mediaItem({ videoCodec: 'hevc' }), mode: 'direct' })).toBe('HEVC')
    expect(playingCodec({ media: mediaItem({ videoCodec: 'hevc' }), mode: 'remux' })).toBe('HEVC')
  })

  it('names none for a transcode, an unknown codec, or no file', () => {
    expect(playingCodec({ media: mediaItem({ videoCodec: 'hevc' }), mode: 'transcode' })).toBeNull()
    expect(playingCodec({ media: mediaItem({ videoCodec: null }), mode: 'direct' })).toBeNull()
    expect(playingCodec({ media: null, mode: 'direct' })).toBeNull()
  })
})

describe('playingResolution', () => {
  it("names the file's own resolution while it reaches the screen untouched", () => {
    expect(playingResolution({ media: uhd, mode: 'direct' })).toBe('4K')
    expect(playingResolution({ media: uhd, mode: 'remux' })).toBe('4K')
  })

  it('names the size a transcode was picked at, keeping the shape and never above the file', () => {
    expect(playingResolution({ media: uhd, mode: 'transcode', quality: 'high720' })).toBe('720p')
    const scope = mediaItem({ width: 3840, height: 1608 })
    expect(playingResolution({ media: scope, mode: 'transcode', quality: 'high1080' })).toBe(
      '1080p',
    )
    const small = mediaItem({ width: 1280, height: 534 })
    expect(playingResolution({ media: small, mode: 'transcode', quality: 'high1080' })).toBe('720p')
  })

  it('says nothing of an unknown file, or a transcode at the server’s size', () => {
    expect(playingResolution({ media: null, mode: 'direct' })).toBeNull()
    expect(playingResolution({ media: uhd, mode: 'transcode' })).toBeNull()
  })
})

describe('playingRange', () => {
  it("names the file's range while the picture reaches the screen untouched", () => {
    expect(playingRange({ media: uhd, mode: 'direct' })).toBe('HDR')
    expect(playingRange({ media: uhd, mode: 'remux' })).toBe('HDR')
    expect(playingRange({ media: { ...uhd, isDolbyVisionOnly: true }, mode: 'direct' })).toBe('DV5')
  })

  it('says nothing of SDR, an unknown file or a transcode', () => {
    expect(playingRange({ media: mediaItem(), mode: 'direct' })).toBeNull()
    expect(playingRange({ media: null, mode: 'direct' })).toBeNull()
    expect(playingRange({ media: uhd, mode: 'transcode' })).toBeNull()
  })
})

describe('qualityLabel', () => {
  it('names the picture while it reaches the screen untouched', () => {
    expect(qualityLabel({ media: uhd, mode: 'direct' })).toBe('4K · Direct play')
    expect(qualityLabel({ media: uhd, mode: 'remux' })).toBe('4K · Remux')
  })

  it('leaves the size of a conversion, and of an unknown file, unsaid', () => {
    expect(qualityLabel({ media: uhd, mode: 'transcode' })).toBe('Transcode')
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
