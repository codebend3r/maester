import { describe, expect, it } from 'vitest'
import { isTransportStream, mediaClockOf, parseProbe } from '@/ffmpeg/probe'

/** Trimmed from a real ffprobe run on a 4K HDR episode on the NAS. */
const hdrEpisode = {
  streams: [
    {
      index: 0,
      codec_name: 'hevc',
      codec_type: 'video',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p10le',
      color_transfer: 'smpte2084',
      disposition: { default: 1, attached_pic: 0 },
    },
    { index: 1, codec_name: 'ac3', codec_type: 'audio', channels: 2, disposition: { default: 0 } },
    { index: 2, codec_name: 'eac3', codec_type: 'audio', channels: 6, disposition: { default: 1 } },
    { index: 3, codec_name: 'subrip', codec_type: 'subtitle', disposition: { default: 0 } },
  ],
  format: { duration: '2914.720000', bit_rate: '13515263', format_name: 'matroska,webm' },
}

describe('parseProbe', () => {
  it('keeps what playback and the cards need', () => {
    expect(parseProbe(hdrEpisode)).toEqual({
      duration: 2914.72,
      width: 3840,
      height: 2160,
      videoCodec: 'hevc',
      videoBitDepth: 10,
      hdr: true,
      audioCodec: 'eac3',
      audioChannels: 6,
      bitrate: 13515263,
    })
  })

  it('skips cover art and falls back to the first audio track', () => {
    const result = parseProbe({
      streams: [
        { index: 0, codec_name: 'mjpeg', codec_type: 'video', disposition: { attached_pic: 1 } },
        {
          index: 1,
          codec_name: 'h264',
          codec_type: 'video',
          width: 1280,
          height: 720,
          pix_fmt: 'yuv420p',
        },
        { index: 2, codec_name: 'aac', codec_type: 'audio', channels: 2 },
      ],
      format: { duration: '60' },
    })
    expect(result).toMatchObject({
      videoCodec: 'h264',
      videoBitDepth: 8,
      hdr: false,
      audioCodec: 'aac',
    })
  })

  it('treats a Dolby Vision record as HDR', () => {
    const result = parseProbe({
      streams: [
        {
          codec_name: 'hevc',
          codec_type: 'video',
          pix_fmt: 'yuv420p10le',
          side_data_list: [{ side_data_type: 'DOVI configuration record' }],
        },
      ],
      format: {},
    })
    expect(result?.hdr).toBe(true)
  })

  it('returns null for a file with nothing playable', () => {
    expect(parseProbe({ streams: [{ codec_type: 'subtitle' }], format: {} })).toBeNull()
    expect(parseProbe('garbage')).toBeNull()
  })
})

describe('mediaClockOf', () => {
  const video = { codec_type: 'video', start_time: '2.580000', r_frame_rate: '24000/1001' }
  const audio = { codec_type: 'audio', start_time: '2.500000' }

  it("reads the start, the video's first frame and its rate", () => {
    expect(
      mediaClockOf({
        format: { format_name: 'mpegts', start_time: '11.375000', duration: '40.062500' },
        streams: [audio, { ...video, start_time: '11.440000', r_frame_rate: '25/1' }],
      }),
    ).toEqual({ start: 11.375, end: 51.4375, videoStart: 11.44, frameRate: 25 })
  })

  it("takes Matroska's duration as its end, since it counts from 0", () => {
    const clock = mediaClockOf({
      format: { format_name: 'matroska,webm', start_time: '2.500000', duration: '14.501000' },
      streams: [video, audio],
    })
    expect(clock).toMatchObject({ start: 2.5, end: 14.501, videoStart: 2.58 })
    expect(clock.frameRate).toBeCloseTo(23.976, 3)
  })

  it('starts before zero, skips cover art, and knows nothing it is not told', () => {
    expect(
      mediaClockOf({
        format: { start_time: '-0.023000' },
        streams: [{ codec_type: 'video', disposition: { attached_pic: 1 }, start_time: '5' }],
      }),
    ).toEqual({ start: -0.023, end: null, videoStart: -0.023, frameRate: null })
    expect(mediaClockOf(null)).toEqual({ start: 0, end: null, videoStart: 0, frameRate: null })
  })
})

describe('isTransportStream', () => {
  it('knows MPEG-TS, M2TS included, from the format ffprobe names', () => {
    expect(
      ['mpegts', 'matroska,webm', 'mov,mp4,m4a,3gp,3g2,mj2'].map((format_name) =>
        isTransportStream({ format: { format_name } }),
      ),
    ).toEqual([true, false, false])
    expect(isTransportStream(null)).toBe(false)
  })
})
