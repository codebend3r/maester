import { describe, expect, it } from 'vitest'
import { parseStreams } from '@/ffmpeg/streams'

describe('parseStreams', () => {
  it('reads an MP4 stream bitrate, a Matroska BPS tag and the sample rate', () => {
    const streams = parseStreams({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'png',
          disposition: { attached_pic: 1 },
        },
        {
          codec_type: 'video',
          codec_name: 'h264',
          profile: 'High',
          bit_rate: '11100000',
          color_transfer: 'bt709',
        },
        {
          codec_type: 'audio',
          codec_name: 'dts',
          profile: 'DTS-HD MA',
          channels: 6,
          sample_rate: '48000',
          tags: { 'BPS-eng': '1509000' },
        },
        {
          codec_type: 'audio',
          codec_name: 'aac',
          profile: 'LC',
          channels: 2,
          sample_rate: '44100',
          tags: { BPS: '192000' },
        },
        { codec_type: 'subtitle', codec_name: 'subrip' },
      ],
    })
    expect(streams).toEqual({
      video: { codec: 'h264', profile: 'High', bitrate: 11_100_000, range: 'sdr' },
      audio: [
        {
          index: 0,
          codec: 'dts',
          profile: 'DTS-HD MA',
          channels: 6,
          bitrate: 1_509_000,
          sampleRate: 48_000,
        },
        {
          index: 1,
          codec: 'aac',
          profile: 'LC',
          channels: 2,
          bitrate: 192_000,
          sampleRate: 44_100,
        },
      ],
    })
  })

  it.each([
    [{ color_transfer: 'smpte2084' }, 'hdr10'],
    [{ color_transfer: 'arib-std-b67' }, 'hlg'],
    [
      {
        color_transfer: 'smpte2084',
        side_data_list: [{ side_data_type: 'DOVI configuration record' }],
      },
      'dolbyVision',
    ],
    [{}, 'sdr'],
  ])('names the range of %j as %s', (fields, range) => {
    expect(
      parseStreams({ streams: [{ codec_type: 'video', codec_name: 'hevc', ...fields }] }).video
        ?.range,
    ).toBe(range)
  })

  it('leaves out what ffprobe does not know', () => {
    expect(
      parseStreams({
        streams: [
          { codec_type: 'video', profile: 'unknown', bit_rate: 'N/A' },
          { codec_type: 'audio', profile: ' ', channels: 0 },
        ],
      }),
    ).toEqual({
      video: { codec: null, profile: null, bitrate: null, range: 'sdr' },
      audio: [
        { index: 0, codec: null, profile: null, channels: null, bitrate: null, sampleRate: null },
      ],
    })
  })

  it('has no picture for a file of sound alone, or for nonsense', () => {
    expect(
      parseStreams({ streams: [{ codec_type: 'audio', codec_name: 'flac' }] }).video,
    ).toBeNull()
    expect(parseStreams(null)).toEqual({ video: null, audio: [] })
  })
})
