import { describe, expect, it } from 'vitest'
import type { VideoEncoder } from '@/ffmpeg/encoder'
import {
  TONEMAP_FILTER,
  streamArgs,
  subtitleFileArgs,
  subtitleWindowArgs,
  thumbnailArgs,
  thumbnailSeek,
} from '@/ffmpeg/args'

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
    videoCodec: 'hevc',
    tonemap: false,
    streamShift: 1,
  }
  const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

  describe('on a GPU', () => {
    const vaapi: VideoEncoder = { kind: 'vaapi', device: '/dev/dri/renderD128' }
    const beforeInput = (args: string[]) => args.slice(0, args.indexOf('-i'))

    it('keeps an H.264 or HEVC transcode on the GPU from decode to encode', () => {
      const args = streamArgs({ ...base, mode: 'transcode', encoder: vaapi })
      expect(beforeInput(args)).toEqual(
        expect.arrayContaining(['-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi']),
      )
      expect(after(args, '-init_hw_device')).toBe('vaapi=va:/dev/dri/renderD128')
      expect(after(args, '-vf')).toBe("scale_vaapi=w=-2:h='min(1080,ih)':format=nv12")
      expect(after(args, '-c:v')).toBe('h264_vaapi')
      expect(args).not.toContain('-pix_fmt')
    })

    it('keeps HDR on the GPU too, converting its colours to BT.709 rather than tone mapping on the CPU', () => {
      const args = streamArgs({ ...base, mode: 'transcode', tonemap: true, encoder: vaapi })
      expect(beforeInput(args)).toEqual(expect.arrayContaining(['-hwaccel_output_format', 'vaapi']))
      expect(after(args, '-vf')).toBe(
        "scale_vaapi=w=-2:h='min(1080,ih)':format=nv12:out_color_matrix=bt709:out_color_primaries=bt709:out_color_transfer=bt709:out_range=tv",
      )
      expect(after(args, '-vf')).not.toContain('zscale')
    })

    it('decodes a codec the GPU may not know on the CPU, then uploads it to encode', () => {
      const args = streamArgs({ ...base, mode: 'transcode', videoCodec: 'mpeg4', encoder: vaapi })
      expect(beforeInput(args)).not.toContain('-hwaccel')
      expect(after(args, '-filter_hw_device')).toBe('va')
      expect(after(args, '-vf')).toBe("scale=w=-2:h='min(1080,ih)',format=nv12,hwupload")
      expect(after(args, '-c:v')).toBe('h264_vaapi')
    })

    it('decodes and encodes on the Apple media engine with VideoToolbox', () => {
      const args = streamArgs({
        ...base,
        mode: 'transcode',
        encoder: { kind: 'videotoolbox' },
      })
      expect(after(beforeInput(args), '-hwaccel')).toBe('videotoolbox')
      expect(after(args, '-c:v')).toBe('h264_videotoolbox')
      expect(after(args, '-vf')).toBe("scale=w=-2:h='min(1080,ih)'")
    })

    it('leaves a remux alone, since nothing is encoded', () => {
      const args = streamArgs({ ...base, mode: 'remux', encoder: vaapi })
      expect(args).not.toContain('-hwaccel')
      expect(args).not.toContain('-init_hw_device')
      expect(after(args, '-c:v')).toBe('copy')
    })
  })

  it('copies the video, keeps the file clock and converts the chosen audio', () => {
    const args = streamArgs({ ...base, mode: 'remux' })
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(after(args, '-ss')).toBe('61.5')
    expect(args).toContain('-copyts')
    expect(args).toContain('0:a:2')
    expect(after(args, '-c:v')).toBe('copy')
    expect(after(args, '-tag:v')).toBe('hvc1')
    expect(after(args, '-c:a')).toBe('aac')
    expect(after(args, '-output_ts_offset')).toBe('1')
    expect(after(args, '-movflags')).toContain('frag_discont')
    expect(args.at(-1)).toBe('pipe:1')
  })

  it('re-encodes the video for a transcode, tone mapping HDR', () => {
    const args = streamArgs({ ...base, mode: 'transcode', start: 0, tonemap: true })
    expect(args).not.toContain('-ss')
    expect(after(args, '-c:v')).toBe('libx264')
    expect(after(args, '-vf')).toBe(`scale=w=-2:h='min(1080,ih)',${TONEMAP_FILTER}`)
    expect(args).not.toContain('-tag:v')
  })

  it('maps no audio for a silent file', () => {
    const args = streamArgs({ ...base, mode: 'remux', audio: null, videoCodec: 'h264' })
    expect(args).not.toContain('-c:a')
    expect(args.filter((arg) => arg === '-map')).toHaveLength(1)
    expect(args).not.toContain('-tag:v')
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
      '-t',
      '310',
      '-copyts',
      '-start_at_zero',
    ])
    expect(args).toContain('0:s:1')
    expect(args.slice(-3)).toEqual(['-f', 'webvtt', '/s/x.vtt'])
  })

  it('converts a sidecar, optionally from another character set', () => {
    expect(
      subtitleFileArgs({ input: '/m/a.srt', output: '/s/x.vtt', charset: null }),
    ).not.toContain('-sub_charenc')
    const args = subtitleFileArgs({ input: '/m/a.srt', output: '/s/x.vtt', charset: 'CP1252' })
    expect(args.indexOf('-sub_charenc')).toBeLessThan(args.indexOf('-i'))
  })
})
