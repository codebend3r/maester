import { PLAYBACK_MODES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { SOFTWARE, type VideoEncoder } from '@/ffmpeg/encoder'
import {
  SEGMENT_CLOCKS,
  TONEMAP_FILTER,
  hlsArgs,
  hlsAudioArgs,
  hlsAudioCodec,
  segmentClockOf,
  streamArgs,
  subtitleFileArgs,
  subtitleWindowArgs,
  thumbnailArgs,
  thumbnailSeek,
  transcodeBitrate,
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
  const after = ({ args, flag }: { args: string[]; flag: string }): string | undefined =>
    args[args.indexOf(flag) + 1]

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
})

describe('hlsArgs', () => {
  // The spike's HEVC clip: its plan from the keyframes, and its AAC track.
  const plan = {
    boundaries: [0, 15.5, 22.125, 31.458, 41.458, 51.458, 59.542, 69.542, 80.042],
    duration: 89.959,
  }
  const aac = {
    index: 1,
    codec: 'aac',
    channels: 2,
    language: null,
    title: null,
    default: false,
  }
  const base = {
    input: '/m/clip.mkv',
    plan,
    audio: aac,
    videoCodec: 'hevc',
    encoder: SOFTWARE,
    maxHeight: 1080,
    quality: 'medium',
    bitrate: null,
    tonemap: false,
    folder: '/d/hls/abc',
    segmentClock: SEGMENT_CLOCKS.run,
  } as const

  it('runs the spike’s remux from segment 4 on the file’s clock, listing each finished file on stdout', () => {
    expect(hlsArgs({ ...base, from: 4, mode: PLAYBACK_MODES.remux })).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-seek_timestamp',
      '1',
      '-ss',
      '41.458',
      '-copyts',
      '-i',
      '/m/clip.mkv',
      '-copypriorss',
      '0',
      '-map',
      '0:v:0',
      '-map',
      '0:a:1',
      '-c:v',
      'copy',
      '-tag:v',
      'hvc1',
      '-c:a',
      'copy',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-output_ts_offset',
      '1',
      '-avoid_negative_ts',
      'disabled',
      '-f',
      'segment',
      '-segment_format',
      'mp4',
      '-segment_format_options',
      'movflags=frag_keyframe+empty_moov+default_base_moof+frag_discont+delay_moov:use_editlist=0:avoid_negative_ts=disabled',
      '-segment_times',
      '10.000,18.084,28.084,38.584',
      '-segment_time_delta',
      '0.005',
      '-segment_start_number',
      '4',
      '-segment_list',
      'pipe:1',
      '-segment_list_type',
      'flat',
      '/d/hls/abc/seg_%d.mp4',
    ])
  })

  it('gives FFmpeg before 6.0 the cuts as output timestamps', () => {
    const args = hlsArgs({
      ...base,
      from: 4,
      mode: PLAYBACK_MODES.remux,
      segmentClock: SEGMENT_CLOCKS.output,
    })
    expect(args[args.indexOf('-segment_times') + 1]).toBe('52.458,60.542,70.542,81.042')
  })

  it('seeks nowhere from a first boundary at zero', () => {
    const args = hlsArgs({ ...base, from: 0, mode: PLAYBACK_MODES.remux })
    expect(args).not.toContain('-ss')
    expect(args[args.indexOf('-segment_times') + 1]).toBe(
      '15.500,22.125,31.458,41.458,51.458,59.542,69.542,80.042',
    )
  })

  it('lets the last segment run to the end', () => {
    const args = hlsArgs({ ...base, from: 8, mode: PLAYBACK_MODES.remux })
    const [end = ''] = (args[args.indexOf('-segment_times') + 1] ?? '').split(',')
    expect(Number(end)).toBeGreaterThan(plan.duration - 80.042)
    expect(args[args.indexOf('-segment_start_number') + 1]).toBe('8')
  })

  it('encodes a transcode with keyframes forced at the boundaries on the file’s clock', () => {
    const args = hlsArgs({
      ...base,
      from: 4,
      mode: PLAYBACK_MODES.transcode,
      maxHeight: 720,
      bitrate: 3_000_000,
    })
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264')
    expect(args).not.toContain('-tag:v')
    expect(args[args.indexOf('-vf') + 1]).toBe("scale=w=-2:h='min(720,ih)'")
    expect(args[args.indexOf('-maxrate') + 1]).toBe('3000000')
    expect(args[args.indexOf('-force_key_frames') + 1]).toBe('41.458,51.458,59.542,69.542,80.042')
    expect(args).toContain('-copypriorss')
  })

  it('maps no audio for a silent file', () => {
    const args = hlsArgs({ ...base, from: 0, mode: PLAYBACK_MODES.remux, audio: null })
    expect(args.filter((arg) => arg === '-map')).toHaveLength(1)
    expect(args).not.toContain('-c:a')
  })
})

describe('segmentClockOf', () => {
  it('reads segment times from the run’s start from FFmpeg 6.0 on', () => {
    expect(segmentClockOf('ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023')).toBe(
      SEGMENT_CLOCKS.run,
    )
    expect(segmentClockOf('ffmpeg version 9.0.2 Copyright (c) 2000-2026')).toBe(SEGMENT_CLOCKS.run)
    expect(segmentClockOf('ffmpeg version 7.1.1-Jellyfin Copyright')).toBe(SEGMENT_CLOCKS.run)
  })

  it('reads them as output timestamps before 6.0', () => {
    expect(segmentClockOf('ffmpeg version 5.1.9-0+deb12u1 Copyright (c) 2000-2026')).toBe(
      SEGMENT_CLOCKS.output,
    )
    expect(segmentClockOf('ffmpeg version n4.4.2 Copyright')).toBe(SEGMENT_CLOCKS.output)
  })

  it('takes a build with no release number, or no ffmpeg, as new', () => {
    expect(segmentClockOf('ffmpeg version N-118000-gabcdef Copyright')).toBe(SEGMENT_CLOCKS.run)
    expect(segmentClockOf(null)).toBe(SEGMENT_CLOCKS.run)
  })
})

describe('hlsAudioArgs', () => {
  const track = {
    index: 0,
    codec: 'aac',
    channels: 2,
    language: null,
    title: null,
    default: true,
  }

  it('copies what HLS players decode', () => {
    expect(hlsAudioArgs(track)).toEqual(['-c:a', 'copy'])
    expect(hlsAudioArgs({ ...track, codec: 'eac3', channels: 8 })).toEqual(['-c:a', 'copy'])
  })

  it('turns anything else into E-AC-3, keeping up to six channels', () => {
    expect(hlsAudioArgs({ ...track, codec: 'truehd', channels: 8 })).toEqual([
      '-c:a',
      'eac3',
      '-ac',
      '6',
      '-b:a',
      '640k',
    ])
    expect(hlsAudioArgs({ ...track, codec: 'dts', channels: 4 })).toEqual([
      '-c:a',
      'eac3',
      '-ac',
      '4',
      '-b:a',
      '448k',
    ])
    expect(hlsAudioArgs({ ...track, codec: 'opus', channels: null })).toEqual([
      '-c:a',
      'eac3',
      '-ac',
      '2',
      '-b:a',
      '224k',
    ])
  })
})

describe('hlsAudioCodec', () => {
  it('names the codec a track keeps, or E-AC-3 for one it is turned into', () => {
    expect(['aac', 'flac', 'truehd', 'dts', null].map((codec) => hlsAudioCodec({ codec }))).toEqual(
      ['aac', 'flac', 'eac3', 'eac3', 'eac3'],
    )
  })
})

describe('transcodeBitrate', () => {
  it("is the viewer's ceiling, else the quality setting's target", () => {
    expect(transcodeBitrate({ quality: 'high', bitrate: 3_000_000 })).toBe(3_000_000)
    expect(transcodeBitrate({ quality: 'high', bitrate: null })).toBe(16_000_000)
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
