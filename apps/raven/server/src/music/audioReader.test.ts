import { LYRICS_KINDS, LYRICS_SOURCES, NO_LYRICS } from '@raven/core'
import {
  type ICommonTagsResult,
  type IFormat,
  LyricsContentType,
  TimestampFormat,
} from 'music-metadata'
import { describe, expect, it } from 'vitest'
import {
  audioChaptersOf,
  audioFormatOf,
  audioProbeOf,
  audioTagsOf,
  audioTracksOf,
  codecNameOf,
  lyricsOfTags,
} from '@/music/audioReader'

/** What `music-metadata` folds a file with no tags to. */
const BLANK: ICommonTagsResult = {
  track: { no: null, of: null },
  disk: { no: null, of: null },
  movementIndex: { no: null, of: null },
}

const FLAC: IFormat = {
  tagTypes: ['vorbis'],
  trackInfo: [],
  container: 'FLAC',
  codec: 'FLAC',
  lossless: true,
  sampleRate: 44100,
  bitsPerSample: 16,
  numberOfChannels: 2,
  duration: 241.5,
  bitrate: 912345.6,
  hasAudio: true,
}

describe('audioTagsOf', () => {
  it('reads every field a Picard-tagged FLAC carries, ids and ReplayGain included', () => {
    expect(
      audioTagsOf({
        ...BLANK,
        title: 'Paranoid Android',
        artist: 'Radiohead',
        artists: ['Radiohead'],
        album: 'OK Computer',
        albumartist: 'Radiohead',
        track: { no: 2, of: 12 },
        disk: { no: 1, of: 1 },
        year: 1997,
        date: '1997-05-21',
        originaldate: '1997-05-21',
        genre: ['Alternative Rock', 'Art Rock'],
        composer: ['Thom Yorke'],
        label: ['Parlophone'],
        catalognumber: ['7243 8 55229 2 8'],
        isrc: ['GBAYE9700508'],
        musicbrainz_recordingid: 'rec-1',
        musicbrainz_albumid: 'rel-1',
        musicbrainz_releasegroupid: 'rg-1',
        musicbrainz_artistid: ['art-1'],
        musicbrainz_albumartistid: ['art-1'],
        releasetype: ['Album'],
        replaygain_track_gain: { dB: -8.5, ratio: 0.3758 },
        replaygain_track_peak: { dB: 0, ratio: 0.988 },
        replaygain_album_gain: { dB: -9.1, ratio: 0.3508 },
        replaygain_album_peak: { dB: 0, ratio: 1 },
        picture: [{ format: 'image/jpeg', data: new Uint8Array([1, 2, 3]) }],
      }),
    ).toEqual({
      title: 'Paranoid Android',
      artists: ['Radiohead'],
      album: 'OK Computer',
      albumArtists: ['Radiohead'],
      trackNumber: 2,
      disc: 1,
      year: 1997,
      originalYear: 1997,
      genres: ['Alternative Rock', 'Art Rock'],
      isCompilation: false,
      label: 'Parlophone',
      isrc: 'GBAYE9700508',
      recordingMbid: 'rec-1',
      releaseMbid: 'rel-1',
      releaseGroupMbid: 'rg-1',
      artistMbids: ['art-1'],
      albumArtistMbids: ['art-1'],
      releaseTypes: ['album'],
      replayGain: { trackGain: -8.5, trackPeak: 0.988, albumGain: -9.1, albumPeak: 1 },
      hasCover: true,
    })
  })

  it('reads an MP3 with ID3 tags alone: one artist, a bare year, no ids, no cover', () => {
    const tags = audioTagsOf({
      ...BLANK,
      title: 'Song 2',
      artist: 'Blur',
      album: 'Blur',
      track: { no: 2, of: null },
      year: 1997,
    })
    expect(tags).toMatchObject({
      title: 'Song 2',
      artists: ['Blur'],
      albumArtists: [],
      trackNumber: 2,
      disc: null,
      year: 1997,
      originalYear: null,
      recordingMbid: null,
      releaseMbid: null,
      hasCover: false,
    })
  })

  it('takes the year off a date when no year tag is written, and nothing off nonsense', () => {
    expect(audioTagsOf({ ...BLANK, date: '2003-04' }).year).toBe(2003)
    expect(audioTagsOf({ ...BLANK, releasedate: '2003' }).year).toBe(2003)
    expect(audioTagsOf({ ...BLANK, date: 'unknown' }).year).toBeNull()
    expect(audioTagsOf({ ...BLANK, year: 0 }).year).toBeNull()
  })

  it('folds blanks away: empty strings, whitespace names and empty lists', () => {
    const tags = audioTagsOf({
      ...BLANK,
      title: '  ',
      artist: '',
      artists: [' ', ''],
      album: ' Live ',
      genre: [],
    })
    expect(tags.title).toBeNull()
    expect(tags.artists).toEqual([])
    expect(tags.album).toBe('Live')
    expect(tags.genres).toEqual([])
  })

  it('prefers the artists list to the one artist, and keeps a compilation flag', () => {
    const tags = audioTagsOf({
      ...BLANK,
      artist: 'A feat. B',
      artists: ['A', 'B'],
      compilation: true,
      albumartists: ['Various Artists'],
    })
    expect(tags.artists).toEqual(['A', 'B'])
    expect(tags.albumArtists).toEqual(['Various Artists'])
    expect(tags.isCompilation).toBe(true)
  })
})

describe('codecNameOf', () => {
  it("names codecs as ffprobe does, so the planner reads a track like a video's audio", () => {
    expect(codecNameOf('MPEG 1 Layer 3')).toBe('mp3')
    expect(codecNameOf('FLAC')).toBe('flac')
    expect(codecNameOf('ALAC')).toBe('alac')
    expect(codecNameOf('AAC')).toBe('aac')
    expect(codecNameOf('Opus')).toBe('opus')
    expect(codecNameOf('Vorbis')).toBe('vorbis')
    expect(codecNameOf('PCM')).toBe('pcm_s16le')
    expect(codecNameOf(undefined)).toBeNull()
    expect(codecNameOf('Some New Codec')).toBe('somenewcodec')
  })
})

describe('audioProbeOf and audioTracksOf', () => {
  it('fills the index facts for a sound with no picture', () => {
    expect(audioProbeOf(FLAC)).toEqual({
      duration: 241.5,
      width: null,
      height: null,
      videoCodec: null,
      videoBitDepth: null,
      hdr: false,
      audioCodec: 'flac',
      audioChannels: 2,
      bitrate: 912346,
    })
  })

  it('gives the player one default audio track and no subtitles or frame rate', () => {
    expect(audioTracksOf(FLAC)).toEqual({
      audio: [{ index: 0, codec: 'flac', channels: 2, language: null, title: null, default: true }],
      subtitles: [],
      defaultAudio: 0,
      frameRate: null,
    })
  })

  it('reads the sample rate and bit depth, and lossless from the flag or the codec', () => {
    expect(audioFormatOf(FLAC)).toEqual({ sampleRate: 44100, bitDepth: 16, isLossless: true })
    expect(
      audioFormatOf({
        ...FLAC,
        codec: 'MPEG 1 Layer 3',
        lossless: false,
        bitsPerSample: undefined,
      }),
    ).toEqual({ sampleRate: 44100, bitDepth: null, isLossless: false })
    expect(audioFormatOf({ ...FLAC, codec: 'ALAC', lossless: undefined }).isLossless).toBe(true)
  })

  it('leaves a duration or a bitrate the reader could not tell null', () => {
    expect(audioProbeOf({ ...FLAC, duration: undefined, bitrate: 0 })).toMatchObject({
      duration: null,
      bitrate: null,
    })
  })
})

describe('audioChaptersOf', () => {
  it("reads an audiobook's chapters in seconds, each running to the next and the last to the end", () => {
    expect(
      audioChaptersOf({
        chapters: [
          { title: 'Two', start: 88_200, timeScale: 44_100 },
          { title: 'One', start: 0, timeScale: 44_100 },
        ],
        duration: 6,
      }),
    ).toEqual([
      { start: 0, end: 2, title: 'One' },
      { start: 2, end: 6, title: 'Two' },
    ])
  })

  it('takes a chapter’s own end, names an untitled one null, and drops one with no length', () => {
    expect(
      audioChaptersOf({
        chapters: [
          { title: '', start: 0, end: 30 },
          { title: 'Empty', start: 30, end: 30 },
          { title: 'Last', start: 40 },
        ],
        duration: null,
      }),
    ).toEqual([{ start: 0, end: 30, title: null }])
    expect(audioChaptersOf({ chapters: undefined, duration: 10 })).toEqual([])
  })
})

describe('lyricsOfTags', () => {
  const tag = {
    contentType: LyricsContentType.lyrics,
    timeStampFormat: TimestampFormat.notSynchronized,
    syncText: [],
  }

  it('takes the synced lines a tag times, in seconds', () => {
    expect(
      lyricsOfTags([
        { ...tag, text: 'Plain first' },
        {
          ...tag,
          timeStampFormat: TimestampFormat.milliseconds,
          syncText: [{ text: ' Hello ', timestamp: 1_500 }, { text: 'untimed' }],
        },
      ]),
    ).toEqual({
      kind: LYRICS_KINDS.synced,
      source: LYRICS_SOURCES.tags,
      lines: [{ at: 1.5, text: 'Hello' }],
    })
  })

  it('reads LRC stamps in an untimed tag’s text, else gives it as plain text, else none', () => {
    expect(lyricsOfTags([{ ...tag, text: '[00:02.00]Stamped' }])).toEqual({
      kind: LYRICS_KINDS.synced,
      source: LYRICS_SOURCES.tags,
      lines: [{ at: 2, text: 'Stamped' }],
    })
    expect(lyricsOfTags([{ ...tag, text: 'Words' }])).toEqual({
      kind: LYRICS_KINDS.plain,
      source: LYRICS_SOURCES.tags,
      text: 'Words',
    })
    expect(lyricsOfTags([{ ...tag, text: ' ' }])).toEqual(NO_LYRICS)
    expect(lyricsOfTags(undefined)).toEqual(NO_LYRICS)
  })
})
