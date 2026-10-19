import { describe, expect, it } from 'vitest'
import { parseProbe, startTimeOf } from '@/ffmpeg/probe'

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

describe('startTimeOf', () => {
  it("reads the format's start, before zero too, and is 0 when there is none", () => {
    expect(
      [
        { format: { start_time: '2.500000' } },
        { format: { start_time: '-0.023220' } },
        { format: { start_time: 'N/A' } },
        { format: {} },
        null,
      ].map(startTimeOf),
    ).toEqual([2.5, -0.02322, 0, 0, 0])
  })
})
