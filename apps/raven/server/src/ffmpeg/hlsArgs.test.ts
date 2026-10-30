import {
  ENCODER_KINDS,
  HLS_COPY_AUDIO_CODECS,
  PLAYBACK_MODES,
  QUALITIES,
  type StreamMode,
  VIDEO_CODECS,
} from '@raven/core'
import { describe, expect, it } from 'vitest'
import { SOFTWARE } from '@/ffmpeg/encoder'
import { DEMUX_TIME_BASES, type HlsDialect, SEGMENT_CLOCKS } from '@/ffmpeg/ffmpegVersion'
import { type HlsSource, hlsArgs, hlsAudioArgs, hlsAudioCodec } from '@/ffmpeg/hlsArgs'
import { transcodePlan } from '@/hls/segmentPlan'

describe('hlsArgs', () => {
  // The spike's HEVC clip: its plan from the keyframes, and its AAC track.
  const plan = {
    boundaries: [0, 15.5, 22.125, 31.458, 41.458, 51.458, 59.542, 69.542, 80.042],
    duration: 89.959,
  }
  const aac = {
    index: 1,
    codec: HLS_COPY_AUDIO_CODECS.aac,
    channels: 2,
    language: null,
    title: null,
    default: false,
  }
  const source = {
    input: '/m/clip.mkv',
    plan,
    audio: aac,
    videoCodec: VIDEO_CODECS.hevc,
    encoder: SOFTWARE,
    maxHeight: 1080,
    quality: QUALITIES.medium,
    bitrate: null,
    tonemap: false,
    startTime: 0,
    frameRate: 24,
    burn: null,
  } as const
  /** A picture subtitle to burn, on a 1080p canvas. */
  const burnOf = (stream: number) => ({ stream, canvas: { width: 1920, height: 1080 } })

  const DIALECT = { segmentClock: SEGMENT_CLOCKS.run, timeBase: DEMUX_TIME_BASES.named } as const

  /** The run from `from` of the spike's clip, with what the test sets apart. */
  const argsFor = ({
    from,
    mode,
    seekKeyframes = null,
    dialect = {},
    ...rest
  }: Partial<HlsSource> & {
    from: number
    mode: StreamMode
    seekKeyframes?: readonly number[] | null
    dialect?: Partial<HlsDialect>
  }): string[] =>
    hlsArgs({
      source: { ...source, mode, ...rest },
      from,
      folder: '/d/hls/abc',
      seekKeyframes,
      dialect: { ...DIALECT, ...dialect },
    })

  it('runs the spike’s remux from segment 4 on the file’s clock, listing each finished file on stdout', () => {
    expect(argsFor({ from: 4, mode: PLAYBACK_MODES.remux })).toEqual([
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
      '0:V:0',
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
    const args = argsFor({
      from: 4,
      mode: PLAYBACK_MODES.remux,
      dialect: { segmentClock: SEGMENT_CLOCKS.output },
    })
    expect(args[args.indexOf('-segment_times') + 1]).toBe('52.458,60.542,70.542,81.042')
  })

  it('seeks nowhere from a first boundary at zero', () => {
    const args = argsFor({ from: 0, mode: PLAYBACK_MODES.remux })
    expect(args).not.toContain('-ss')
    expect(args[args.indexOf('-segment_times') + 1]).toBe(
      '15.500,22.125,31.458,41.458,51.458,59.542,69.542,80.042',
    )
  })

  it('lets the last segment run to the end', () => {
    const args = argsFor({ from: 8, mode: PLAYBACK_MODES.remux })
    const [end = ''] = (args[args.indexOf('-segment_times') + 1] ?? '').split(',')
    expect(Number(end)).toBeGreaterThan(plan.duration - 80.042)
    expect(args[args.indexOf('-segment_start_number') + 1]).toBe('8')
  })

  it('encodes a transcode with keyframes forced at the boundaries on the file’s clock', () => {
    const args = argsFor({
      from: 4,
      mode: PLAYBACK_MODES.transcode,
      maxHeight: 720,
      bitrate: 3_000_000,
    })
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264')
    expect(args).not.toContain('-tag:v')
    expect(args[args.indexOf('-vf') + 1]).toBe("scale=w=-2:h='min(720,ih)'")
    expect(args[args.indexOf('-maxrate') + 1]).toBe('3000000')
  })

  it("seeks a transcode from the file's start and cuts it half a frame before each boundary", () => {
    const args = argsFor({
      plan: transcodePlan({ start: 2.5, duration: 40, frameRate: 25 }),
      from: 2,
      mode: PLAYBACK_MODES.transcode,
      startTime: 2.494,
      frameRate: 25,
    })
    const after = (flag: string) => args[args.indexOf(flag) + 1]
    // The decoder keeps what is at or after -ss plus the file's start time.
    expect(args).not.toContain('-seek_timestamp')
    expect(after('-ss')).toBe('11.986')
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(after('-fps_mode')).toBe('passthrough')
    expect(after('-enc_time_base')).toBe('demux')
    expect(after('-force_key_frames')).toBe('14.480,20.480,26.480,32.480,38.480')
    expect(after('-segment_times')).toBe('6.000,12.000,18.000,24.000')
    expect(after('-segment_time_delta')).toBe('0.02')
  })

  it('names the demuxer’s time base as this ffmpeg takes it', () => {
    const args = argsFor({
      from: 0,
      mode: PLAYBACK_MODES.transcode,
      dialect: { timeBase: DEMUX_TIME_BASES.numbered },
    })
    expect(args[args.indexOf('-enc_time_base') + 1]).toBe('-1')
  })

  it('reads a transport stream’s video from its keyframe, trimmed, and its sound from the boundary', () => {
    const args = argsFor({
      plan: transcodePlan({ start: 11.44, duration: 51.44, frameRate: 25 }),
      from: 2,
      mode: PLAYBACK_MODES.transcode,
      startTime: 11.377,
      frameRate: 25,
      seekKeyframes: [11.44, 21.44, 31.44, 41.44],
    })
    // The keyframe at or before 23.44 is 21.44; both seeks count from the start, 11.377.
    expect(args.slice(args.indexOf('-ss'), args.lastIndexOf('-i') + 2)).toEqual([
      '-ss',
      '10.043',
      '-copyts',
      '-i',
      '/m/clip.mkv',
      '-ss',
      '12.043',
      '-copyts',
      '-i',
      '/m/clip.mkv',
    ])
    expect(args).toContain('1:a:1')
    expect(args[args.indexOf('-vf') + 1]).toBe("trim=start=23.420,scale=w=-2:h='min(1080,ih)'")
  })

  it('reads a transport stream from the top in one input when its first run needs no seek', () => {
    const args = argsFor({
      plan: transcodePlan({ start: 0, duration: 30, frameRate: 25 }),
      from: 0,
      mode: PLAYBACK_MODES.transcode,
      frameRate: 25,
      seekKeyframes: [0, 10, 20],
    })
    expect(args.filter((arg) => arg === '-i')).toHaveLength(1)
    expect(args).toContain('0:a:1')
    expect(args[args.indexOf('-vf') + 1]).not.toContain('trim')
  })

  it('reads a transcode from the top when its first frame is the file’s', () => {
    const args = argsFor({
      plan: transcodePlan({ start: 0, duration: 30, frameRate: 25 }),
      from: 0,
      mode: PLAYBACK_MODES.transcode,
      frameRate: 25,
    })
    expect(args).not.toContain('-ss')
  })

  it('burns a picture subtitle into a transcode: overlaid on the frame, then scaled with it', () => {
    const args = argsFor({ from: 0, mode: PLAYBACK_MODES.transcode, burn: burnOf(2) })
    expect(args).not.toContain('-vf')
    expect(args).not.toContain('-copyts')
    expect(args[args.indexOf('-canvas_size') + 1]).toBe('1920x1080')
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      "[0:V:0][0:s:2]overlay=eof_action=pass,scale=w=-2:h='min(1080,ih)'[vout]",
    )
    expect(args[args.indexOf('-map') + 1]).toBe('[vout]')
    expect(args).not.toContain('0:V:0')
  })

  it('trims a transport stream before the overlay, so the subtitles keep the file’s clock', () => {
    const args = argsFor({
      plan: transcodePlan({ start: 11.44, duration: 51.44, frameRate: 25 }),
      from: 2,
      mode: PLAYBACK_MODES.transcode,
      startTime: 11.377,
      frameRate: 25,
      seekKeyframes: [11.44, 21.44, 31.44, 41.44],
      burn: burnOf(0),
    })
    // On a clock from the keyframe it sought to, 21.42: the boundary is 2 s on, and so is the audio.
    expect(
      args.slice(0, args.lastIndexOf('-i') + 2).filter((arg) => arg !== '-hide_banner'),
    ).toEqual(
      expect.arrayContaining(['-ss', '10.043', '-canvas_size', '1920x1080', '-itsoffset', '2.000']),
    )
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      "[0:V:0]trim=start=2.000[base];[base][0:s:0]overlay=eof_action=pass,scale=w=-2:h='min(1080,ih)'[vout]",
    )
    expect(args[args.indexOf('-force_key_frames') + 1]?.split(',')[0] ?? null).toBe('2.000')
    expect(args[args.indexOf('-output_ts_offset') + 1]).toBe('22.42')
    expect(args).toContain('1:a:1')
  })

  it('decodes on the CPU to burn under VAAPI, since the overlay works on frames in memory', () => {
    const args = argsFor({
      from: 0,
      mode: PLAYBACK_MODES.transcode,
      videoCodec: VIDEO_CODECS.h264,
      encoder: { kind: ENCODER_KINDS.vaapi, device: '/dev/dri/renderD128' },
      burn: burnOf(1),
    })
    expect(args).not.toContain('-hwaccel')
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      "[0:V:0][0:s:1]overlay=eof_action=pass,scale=w=-2:h='min(1080,ih)',format=nv12,hwupload[vout]",
    )
    expect(args[args.indexOf('-c:v') + 1]).toBe('h264_vaapi')
  })

  it('maps no audio for a silent file', () => {
    const args = argsFor({ from: 0, mode: PLAYBACK_MODES.remux, audio: null })
    expect(args.filter((arg) => arg === '-map')).toHaveLength(1)
    expect(args).not.toContain('-c:a')
  })
})

describe('hlsAudioArgs', () => {
  const track = {
    index: 0,
    codec: HLS_COPY_AUDIO_CODECS.aac,
    channels: 2,
    language: null,
    title: null,
    default: true,
  }

  it('copies what HLS players decode', () => {
    expect(hlsAudioArgs(track)).toEqual(['-c:a', 'copy'])
    expect(hlsAudioArgs({ ...track, codec: HLS_COPY_AUDIO_CODECS.eac3, channels: 8 })).toEqual([
      '-c:a',
      'copy',
    ])
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
