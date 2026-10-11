import { describe, expect, it } from 'vitest'
import { parseTracks } from '@/ffmpeg/tracks'

const probe = {
  streams: [
    { codec_type: 'video', codec_name: 'hevc', avg_frame_rate: '24000/1001' },
    {
      codec_type: 'audio',
      codec_name: 'truehd',
      channels: 8,
      tags: { language: 'eng', title: 'Surround 7.1' },
      disposition: { default: 0 },
    },
    {
      codec_type: 'audio',
      codec_name: 'ac3',
      channels: 2,
      tags: { language: 'eng', title: 'Commentary' },
      disposition: { default: 1 },
    },
    {
      codec_type: 'subtitle',
      codec_name: 'subrip',
      tags: { language: 'eng' },
      disposition: { forced: 1 },
    },
    {
      codec_type: 'subtitle',
      codec_name: 'hdmv_pgs_subtitle',
      tags: { language: 'jpn' },
      disposition: { hearing_impaired: 1 },
    },
    { codec_type: 'attachment', codec_name: 'ttf' },
  ],
}

describe('parseTracks', () => {
  it('lists audio tracks by their 0:a:N index, with the flagged one as default', () => {
    const tracks = parseTracks(probe)
    expect(tracks.audio).toEqual([
      {
        index: 0,
        codec: 'truehd',
        channels: 8,
        language: 'en',
        title: 'Surround 7.1',
        default: false,
      },
      { index: 1, codec: 'ac3', channels: 2, language: 'en', title: 'Commentary', default: true },
    ])
    expect(tracks.defaultAudio).toBe(1)
  })

  it('marks text subtitles as showable and picture ones as not', () => {
    expect(parseTracks(probe).subtitles).toEqual([
      {
        id: 'embedded-0',
        source: 'embedded',
        codec: 'subrip',
        language: 'en',
        title: null,
        default: false,
        forced: true,
        hearingImpaired: false,
        supported: true,
      },
      {
        id: 'embedded-1',
        source: 'embedded',
        codec: 'hdmv_pgs_subtitle',
        language: 'ja',
        title: null,
        default: false,
        forced: false,
        hearingImpaired: true,
        supported: false,
      },
    ])
  })

  it('reads the frame rate, and defaults to the first audio track', () => {
    const tracks = parseTracks({
      streams: [
        { codec_type: 'video', avg_frame_rate: '0/0', r_frame_rate: '25/1' },
        { codec_type: 'audio', codec_name: 'aac', tags: { language: 'und' } },
      ],
    })
    expect(tracks.frameRate).toBe(25)
    expect(tracks.defaultAudio).toBe(0)
    expect(tracks.audio[0]?.language).toBeNull()
  })

  it('copes with garbage', () => {
    expect(parseTracks(null)).toEqual({
      audio: [],
      subtitles: [],
      defaultAudio: null,
      frameRate: null,
    })
  })
})
