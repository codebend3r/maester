import { PLAYBACK_MODES, type SubtitleTrack, SUBTITLE_SOURCES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import {
  masterPlaylist,
  mediaPlaylist,
  subtitlePlaylist,
  subtitleSegmentCount,
} from '@/hls/playlists'

const SPIKE_PLAN = {
  boundaries: [0, 15.5, 22.125, 31.458, 41.458, 51.458, 59.542, 69.542, 80.042],
  duration: 89.959,
}

const track = (overrides: Partial<SubtitleTrack>): SubtitleTrack => ({
  id: 'embedded-0',
  source: SUBTITLE_SOURCES.embedded,
  codec: 'subrip',
  language: 'en',
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...overrides,
})

const VARIANT = {
  variantUri: '/api/media/m1/hls/s1/video.m3u8?t=tk',
  codecs: 'hvc1.2.4.L150.B0,mp4a.40.2',
  resolution: { width: 1920, height: 1080 },
  bandwidth: 8_000_000,
}

describe('mediaPlaylist', () => {
  it('writes the spike plan as a VOD playlist', () => {
    const playlist = mediaPlaylist({
      plan: SPIKE_PLAN,
      initUri: '/api/media/m1/hls/s1/init?t=tk',
      segmentUri: (n) => `/api/media/m1/hls/s1/segment/${n}?t=tk`,
    })

    expect(playlist).toBe(`#EXTM3U
#EXT-X-VERSION:7
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-TARGETDURATION:16
#EXT-X-MAP:URI="/api/media/m1/hls/s1/init?t=tk"
#EXTINF:15.500,
/api/media/m1/hls/s1/segment/0?t=tk
#EXTINF:6.625,
/api/media/m1/hls/s1/segment/1?t=tk
#EXTINF:9.333,
/api/media/m1/hls/s1/segment/2?t=tk
#EXTINF:10.000,
/api/media/m1/hls/s1/segment/3?t=tk
#EXTINF:10.000,
/api/media/m1/hls/s1/segment/4?t=tk
#EXTINF:8.084,
/api/media/m1/hls/s1/segment/5?t=tk
#EXTINF:10.000,
/api/media/m1/hls/s1/segment/6?t=tk
#EXTINF:10.500,
/api/media/m1/hls/s1/segment/7?t=tk
#EXTINF:9.917,
/api/media/m1/hls/s1/segment/8?t=tk
#EXT-X-ENDLIST
`)
  })

  it('takes the ceiling of the longest segment as the target duration', () => {
    const playlist = mediaPlaylist({
      plan: { boundaries: [0, 10], duration: 20 },
      initUri: 'i',
      segmentUri: (n) => `s${n}`,
    })

    expect(playlist).toContain('#EXT-X-TARGETDURATION:10\n')
  })
})

describe('masterPlaylist', () => {
  it('lists a forced English sidecar and leaves out a picture track', () => {
    const playlist = masterPlaylist({
      ...VARIANT,
      mode: PLAYBACK_MODES.remux,
      subtitles: [
        {
          track: track({ id: 'external-0', source: SUBTITLE_SOURCES.external, forced: true }),
          uri: '/api/media/m1/hls/s1/subtitles/external-0?t=tk',
        },
        {
          track: track({
            id: 'embedded-1',
            codec: 'hdmv_pgs_subtitle',
            language: 'fr',
            supported: false,
          }),
          uri: '/api/media/m1/hls/s1/subtitles/embedded-1?t=tk',
        },
      ],
    })

    expect(playlist).toBe(`#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English (Forced · File)",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,FORCED=YES,URI="/api/media/m1/hls/s1/subtitles/external-0?t=tk"
#EXT-X-STREAM-INF:BANDWIDTH=8000000,CODECS="hvc1.2.4.L150.B0,mp4a.40.2",RESOLUTION=1920x1080,SUBTITLES="subs"
/api/media/m1/hls/s1/video.m3u8?t=tk
`)
  })

  it('writes the independent segments tag for a transcode only', () => {
    const transcode = masterPlaylist({ ...VARIANT, mode: PLAYBACK_MODES.transcode, subtitles: [] })
    const remux = masterPlaylist({ ...VARIANT, mode: PLAYBACK_MODES.remux, subtitles: [] })

    expect(transcode).toBe(`#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=8000000,CODECS="hvc1.2.4.L150.B0,mp4a.40.2",RESOLUTION=1920x1080
/api/media/m1/hls/s1/video.m3u8?t=tk
`)
    expect(remux).not.toContain('INDEPENDENT-SEGMENTS')
  })

  it('names no subtitle group when only picture tracks exist', () => {
    const playlist = masterPlaylist({
      ...VARIANT,
      mode: PLAYBACK_MODES.remux,
      subtitles: [{ track: track({ supported: false }), uri: 'u' }],
    })

    expect(playlist).not.toContain('SUBTITLES')
  })

  it('omits LANGUAGE for a track with none and leaves non-forced tracks unselected', () => {
    const playlist = masterPlaylist({
      ...VARIANT,
      mode: PLAYBACK_MODES.remux,
      subtitles: [{ track: track({ language: null, title: 'Commentary' }), uri: 'u0' }],
    })

    expect(playlist).toContain(
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Unknown language (Commentary)",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,URI="u0"\n',
    )
  })

  it('strips double quotes from a label and numbers duplicate names', () => {
    const playlist = masterPlaylist({
      ...VARIANT,
      mode: PLAYBACK_MODES.remux,
      subtitles: [
        { track: track({ id: 'embedded-0', title: 'The "Director"' }), uri: 'u0' },
        { track: track({ id: 'embedded-1' }), uri: 'u1' },
        { track: track({ id: 'embedded-2' }), uri: 'u2' },
      ],
    })

    expect(playlist).toContain('NAME="English (The Director)"')
    expect(playlist).toContain('NAME="English",')
    expect(playlist).toContain('NAME="English 2",')
  })
})

describe('subtitleSegmentCount', () => {
  it('counts a short last segment, and none past the end', () => {
    expect([13.5, 12, 12.0004, 0].map(subtitleSegmentCount)).toEqual([3, 2, 2, 0])
  })
})

describe('subtitlePlaylist', () => {
  it('lists six-second segments with a shorter last one', () => {
    const playlist = subtitlePlaylist({ duration: 13.5, segmentUri: (n) => `/vtt/${n}?t=tk` })

    expect(playlist).toBe(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-TARGETDURATION:6
#EXTINF:6.000,
/vtt/0?t=tk
#EXTINF:6.000,
/vtt/1?t=tk
#EXTINF:1.500,
/vtt/2?t=tk
#EXT-X-ENDLIST
`)
  })

  it('has no map and no short segment when the duration divides evenly', () => {
    const playlist = subtitlePlaylist({ duration: 12, segmentUri: (n) => `/vtt/${n}` })

    expect(playlist).not.toContain('EXT-X-MAP')
    expect(playlist.match(/#EXTINF/g)).toHaveLength(2)
  })
})
