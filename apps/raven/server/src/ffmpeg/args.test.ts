import { QUALITIES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import type { VideoEncoder } from '@/ffmpeg/encoder'
import {
  TONEMAP_FILTER,
  VIDEO_STREAM,
  streamArgs,
  subtitleFileArgs,
  subtitleWindowArgs,
  thumbnailArgs,
  thumbnailSeek,
  transcodeBitrate,
} from '@/ffmpeg/args'

type AfterProps = { args: string[]; flag: string }

const after = ({ args, flag }: AfterProps): string | undefined => args[args.indexOf(flag) + 1]

describe('VIDEO_STREAM', () => {
  it('is the first video stream that is not an attached picture', () => {
    expect(VIDEO_STREAM).toBe('0:V:0')
  })
})

describe('thumbnailSeek', () => {
  it('lands a tenth of the way in', () => {
    expect(thumbnailSeek(5812.768)).toBe(581.277)
  })

  it('uses the first frame for short or unknown clips', () => {
    expect(thumbnailSeek(3)).toBe(0)
    expect(thumbnailSeek(null)).toBe(0)
  })
})

describe('thumbnailArgs', () => {
  it('seeks on the input so ffmpeg jumps to a keyframe', () => {
    const args = thumbnailArgs({
      input: '/m/a.mkv',
      output: '/t/1.jpg',
      seek: 60,
      width: 480,
      tonemap: false,
    })
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args).toContain('thumbnail=n=24,scale=w=480:h=-2')
    expect(after({ args, flag: '-map' })).toBe(VIDEO_STREAM)
    expect(args.at(-1)).toBe('/t/1.jpg')
  })

  it('leaves out the seek at zero and adds tone mapping for HDR', () => {
    const args = thumbnailArgs({
      input: '/m/a.mkv',
      output: '/t/1.jpg',
      seek: 0,
      width: 320,
      tonemap: true,
    })
    expect(args).not.toContain('-ss')
    expect(args).toContain(`thumbnail=n=24,scale=w=320:h=-2,${TONEMAP_FILTER}`)
  })
})

describe('streamArgs', () => {
  const base = {
    input: '/m/a.mkv',
    start: 61.5,
    audio: 2,
    audioOnly: false,
    videoCodec: 'hevc',
    tonemap: false,
    streamShift: 1,
  }

  describe('on a GPU', () => {
    const vaapi: VideoEncoder = { kind: 'vaapi', device: '/dev/dri/renderD128' }
    const beforeInput = (args: string[]) => args.slice(0, args.indexOf('-i'))

    it('keeps an H.264 or HEVC transcode on the GPU from decode to encode', () => {
      const args = streamArgs({ ...base, mode: 'transcode', encoder: vaapi })
      expect(beforeInput(args)).toEqual(
        expect.arrayContaining(['-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi']),
      )
      expect(after({ args, flag: '-init_hw_device' })).toBe('vaapi=va:/dev/dri/renderD128')
      expect(after({ args, flag: '-vf' })).toBe("scale_vaapi=w=-2:h='min(1080,ih)':format=nv12")
      expect(after({ args, flag: '-c:v' })).toBe('h264_vaapi')
      expect(args).not.toContain('-pix_fmt')
    })

    it('keeps HDR on the GPU too, converting its colours to BT.709 rather than tone mapping on the CPU', () => {
      const args = streamArgs({ ...base, mode: 'transcode', tonemap: true, encoder: vaapi })
      expect(beforeInput(args)).toEqual(expect.arrayContaining(['-hwaccel_output_format', 'vaapi']))
      expect(after({ args, flag: '-vf' })).toBe(
        "scale_vaapi=w=-2:h='min(1080,ih)':format=nv12:out_color_matrix=bt709:out_color_primaries=bt709:out_color_transfer=bt709:out_range=tv",
      )
      expect(after({ args, flag: '-vf' })).not.toContain('zscale')
    })

    it('decodes a codec the GPU may not know on the CPU, then uploads it to encode', () => {
      const args = streamArgs({ ...base, mode: 'transcode', videoCodec: 'mpeg4', encoder: vaapi })
      expect(beforeInput(args)).not.toContain('-hwaccel')
      expect(after({ args, flag: '-filter_hw_device' })).toBe('va')
      expect(after({ args, flag: '-vf' })).toBe("scale=w=-2:h='min(1080,ih)',format=nv12,hwupload")
      expect(after({ args, flag: '-c:v' })).toBe('h264_vaapi')
    })

    it('decodes and encodes on the Apple media engine with VideoToolbox', () => {
      const args = streamArgs({
        ...base,
        mode: 'transcode',
        encoder: { kind: 'videotoolbox' },
      })
      expect(after({ args: beforeInput(args), flag: '-hwaccel' })).toBe('videotoolbox')
      expect(after({ args, flag: '-c:v' })).toBe('h264_videotoolbox')
      expect(after({ args, flag: '-vf' })).toBe("scale=w=-2:h='min(1080,ih)'")
    })

    it('leaves a remux alone, since nothing is encoded', () => {
      const args = streamArgs({ ...base, mode: 'remux', encoder: vaapi })
      expect(args).not.toContain('-hwaccel')
      expect(args).not.toContain('-init_hw_device')
      expect(after({ args, flag: '-c:v' })).toBe('copy')
    })
  })

  it('copies the video, keeps the file clock and converts the chosen audio', () => {
    const args = streamArgs({ ...base, mode: 'remux' })
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(after({ args, flag: '-ss' })).toBe('61.5')
    expect(args).toContain('-copyts')
    expect(after({ args, flag: '-map' })).toBe(VIDEO_STREAM)
    expect(args).toContain('0:a:2')
    expect(after({ args, flag: '-c:v' })).toBe('copy')
    expect(after({ args, flag: '-tag:v' })).toBe('hvc1')
    expect(after({ args, flag: '-c:a' })).toBe('aac')
    expect(after({ args, flag: '-output_ts_offset' })).toBe('1')
    expect(after({ args, flag: '-movflags' })).toContain('frag_discont')
    expect(after({ args, flag: '-frag_duration' })).toBe('1000000')
    expect(args.at(-1)).toBe('pipe:1')
  })

  it('scales a transcode to the settings’ height and squeezes to their quality', () => {
    const args = streamArgs({
      input: '/m/a.mkv',
      start: 0,
      mode: 'transcode',
      audio: 0,
      audioOnly: false,
      videoCodec: 'hevc',
      tonemap: false,
      streamShift: 1,
      maxHeight: 720,
      quality: 'high',
    })
    expect(after({ args, flag: '-vf' })).toBe("scale=w=-2:h='min(720,ih)'")
    expect(after({ args, flag: '-crf' })).toBe('18')
    const low = streamArgs({
      input: '/m/a.mkv',
      start: 0,
      mode: 'transcode',
      audio: 0,
      audioOnly: false,
      videoCodec: 'hevc',
      tonemap: false,
      streamShift: 1,
      encoder: { kind: 'videotoolbox' },
      maxHeight: 2160,
      quality: 'low',
    })
    expect(after({ args: low, flag: '-b:v' })).toBe('4000000')
    expect(after({ args: low, flag: '-vf' })).toBe("scale=w=-2:h='min(2160,ih)'")
  })

  it('holds a transcode under the bitrate a viewer asked for', () => {
    const software = streamArgs({ ...base, mode: 'transcode', maxHeight: 720, bitrate: 3_000_000 })
    expect(after({ args: software, flag: '-maxrate' })).toBe('3000000')
    expect(after({ args: software, flag: '-bufsize' })).toBe('6000000')
    const vaapi = streamArgs({
      ...base,
      mode: 'transcode',
      encoder: { kind: 'vaapi', device: '/dev/dri/renderD128' },
      bitrate: 3_000_000,
    })
    expect(after({ args: vaapi, flag: '-b:v' })).toBe('3000000')
    expect(vaapi).not.toContain('-qp')
    const toolbox = streamArgs({
      ...base,
      mode: 'transcode',
      encoder: { kind: 'videotoolbox' },
      bitrate: 3_000_000,
    })
    expect(after({ args: toolbox, flag: '-b:v' })).toBe('3000000')
    expect(after({ args: toolbox, flag: '-maxrate' })).toBe('3000000')
    expect(after({ args: vaapi, flag: '-bufsize' })).toBe('6000000')
    expect(streamArgs({ ...base, mode: 'transcode' })).not.toContain('-maxrate')
  })

  it('re-encodes the video for a transcode, tone mapping HDR', () => {
    const args = streamArgs({ ...base, mode: 'transcode', start: 0, tonemap: true })
    expect(args).not.toContain('-ss')
    expect(after({ args, flag: '-c:v' })).toBe('libx264')
    expect(after({ args, flag: '-vf' })).toBe(`scale=w=-2:h='min(1080,ih)',${TONEMAP_FILTER}`)
    expect(args).not.toContain('-tag:v')
    expect(after({ args, flag: '-frag_duration' })).toBe('1000000')
  })

  it('maps no audio for a silent file', () => {
    const args = streamArgs({ ...base, mode: 'remux', audio: null, videoCodec: 'h264' })
    expect(args).not.toContain('-c:a')
    expect(args.filter((arg) => arg === '-map')).toHaveLength(1)
    expect(args).not.toContain('-tag:v')
  })

  it.each(['remux', 'transcode'] as const)(
    'streams an audio file as its audio alone, fragmented by time, on a %s',
    (mode) => {
      const args = streamArgs({ ...base, mode, audio: 0, audioOnly: true, videoCodec: null })
      expect(args).not.toContain(VIDEO_STREAM)
      expect(args).not.toContain('-c:v')
      expect(args).not.toContain('-vf')
      expect(args.filter((arg) => arg === '-map')).toHaveLength(1)
      expect(after({ args, flag: '-map' })).toBe('0:a:0')
      expect(after({ args, flag: '-c:a' })).toBe('aac')
      expect(after({ args, flag: '-movflags' })).not.toContain('frag_keyframe')
      expect(after({ args, flag: '-frag_duration' })).toBe('1000000')
    },
  )
})

describe('transcodeBitrate', () => {
  it("is the viewer's ceiling, else the quality setting's target", () => {
    expect(transcodeBitrate({ quality: QUALITIES.high, bitrate: 3_000_000 })).toBe(3_000_000)
    expect(transcodeBitrate({ quality: QUALITIES.high, bitrate: null })).toBe(16_000_000)
  })
})

describe('subtitle args', () => {
  it('reads one window of an embedded track as WebVTT on the file clock', () => {
    const args = subtitleWindowArgs({
      input: '/m/a.mkv',
      stream: 1,
      start: 590,
      duration: 310,
      output: '/s/x.vtt',
    })
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-i'))).toEqual([
      '-ss',
      '590',
      '-copyts',
      '-start_at_zero',
    ])
    expect(args).not.toContain('-t')
    // The end is an absolute position on the output side, so the read stops there.
    expect(args.slice(args.indexOf('-map'))).toEqual([
      '-map',
      '0:s:1',
      '-to',
      '900',
      '-f',
      'webvtt',
      '/s/x.vtt',
    ])
  })

  it('converts a sidecar, optionally from another character set', () => {
    expect(
      subtitleFileArgs({ input: '/m/a.srt', output: '/s/x.vtt', charset: null }),
    ).not.toContain('-sub_charenc')
    const args = subtitleFileArgs({ input: '/m/a.srt', output: '/s/x.vtt', charset: 'CP1252' })
    expect(args.indexOf('-sub_charenc')).toBeLessThan(args.indexOf('-i'))
  })
})
