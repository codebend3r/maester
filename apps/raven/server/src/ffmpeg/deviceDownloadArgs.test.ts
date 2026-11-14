import { AUDIO_CODECS, type AudioTrack, VIDEO_CODECS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { deviceDownloadArgs, progressSeconds } from '@/ffmpeg/deviceDownloadArgs'

type TrackProps = { index: number; codec: string | null; channels: number | null }

const track = ({ index, codec, channels }: TrackProps): AudioTrack => ({
  index,
  codec,
  channels,
  language: null,
  title: null,
  default: index === 0,
})

type AfterProps = { args: readonly string[]; flag: string }

const after = ({ args, flag }: AfterProps): string | undefined => args[args.indexOf(flag) + 1]

describe('deviceDownloadArgs', () => {
  const base = { input: '/in.mkv', output: '/out.mp4', dolbyVision: null, textSubtitles: [] }

  it('copies the video, tagging HEVC hvc1, and writes a faststart MP4 with progress on stdout', () => {
    const args = deviceDownloadArgs({ ...base, videoCodec: VIDEO_CODECS.hevc, audio: [] })
    expect(after({ args, flag: '-c:v' })).toBe('copy')
    expect(after({ args, flag: '-tag:v' })).toBe('hvc1')
    expect(after({ args, flag: '-movflags' })).toBe('+faststart')
    expect(after({ args, flag: '-progress' })).toBe('pipe:1')
    expect(after({ args, flag: '-f' })).toBe('mp4')
    expect(args.at(-1)).toBe('/out.mp4')
    expect(deviceDownloadArgs({ ...base, videoCodec: VIDEO_CODECS.h264, audio: [] })).not.toContain(
      '-tag:v',
    )
  })

  it('copies Dolby Vision HEVC under dvh1 with its box, so AVPlayer renders it itself', () => {
    const args = deviceDownloadArgs({
      ...base,
      videoCodec: VIDEO_CODECS.hevc,
      dolbyVision: { profile: 5, level: 6, blSignalCompatibilityId: 0 },
      audio: [],
    })
    expect(args.join(' ')).toContain('-c:v copy -tag:v dvh1 -strict unofficial')
    expect(args).not.toContain('hvc1')
  })

  it('copies Dolby Vision profile 7 as its HDR10 base layer, since AVPlayer decodes no profile 7', () => {
    const args = deviceDownloadArgs({
      ...base,
      videoCodec: VIDEO_CODECS.hevc,
      dolbyVision: { profile: 7, level: 6, blSignalCompatibilityId: 6 },
      audio: [],
    })
    expect(args.join(' ')).toContain('-c:v copy -tag:v hvc1 -bsf:v filter_units=remove_types=62|63')
    expect(args).not.toContain('dvh1')
  })

  it('copies the audio AVPlayer plays and converts the rest to E-AC-3 of at most 5.1', () => {
    const args = deviceDownloadArgs({
      ...base,
      videoCodec: VIDEO_CODECS.h264,
      audio: [
        track({ index: 0, codec: AUDIO_CODECS.eac3, channels: 6 }),
        track({ index: 1, codec: AUDIO_CODECS.truehd, channels: 8 }),
        track({ index: 2, codec: AUDIO_CODECS.opus, channels: null }),
        track({ index: 3, codec: AUDIO_CODECS.mp3, channels: 2 }),
        track({ index: 4, codec: AUDIO_CODECS.dts, channels: 4 }),
      ],
    })
    expect(after({ args, flag: '-c:a:0' })).toBe('copy')
    expect(after({ args, flag: '-c:a:1' })).toBe('eac3')
    expect(after({ args, flag: '-b:a:1' })).toBe('640k')
    expect(after({ args, flag: '-ac:a:1' })).toBe('6')
    expect(after({ args, flag: '-c:a:2' })).toBe('eac3')
    expect(after({ args, flag: '-b:a:2' })).toBe('224k')
    expect(after({ args, flag: '-ac:a:2' })).toBe('2')
    expect(after({ args, flag: '-c:a:3' })).toBe('copy')
    expect(after({ args, flag: '-b:a:4' })).toBe('448k')
    expect(after({ args, flag: '-ac:a:4' })).toBe('4')
  })

  it('maps only the text subtitles it is given, as mov_text', () => {
    const args = deviceDownloadArgs({
      ...base,
      videoCodec: VIDEO_CODECS.h264,
      audio: [],
      textSubtitles: [0, 2],
    })
    expect(args.join(' ')).toContain('-map 0:s:0 -map 0:s:2')
    expect(after({ args, flag: '-c:s' })).toBe('mov_text')
    expect(deviceDownloadArgs({ ...base, videoCodec: null, audio: [] })).not.toContain('-c:s')
  })
})

describe('progressSeconds', () => {
  it('reads the last out_time_us ffmpeg printed, in seconds', () => {
    expect(progressSeconds('frame=1\nout_time_us=1500000\nprogress=continue\n')).toBe(1.5)
    expect(progressSeconds('out_time_us=1000000\nout_time_us=2000000\n')).toBe(2)
    expect(progressSeconds('out_time_us=N/A\nprogress=continue\n')).toBeNull()
  })
})
