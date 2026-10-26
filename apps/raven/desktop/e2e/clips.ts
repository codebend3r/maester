import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Clips = { folder: string; first: string; second: string }

export const CLIP_SECONDS = 30

// H.264 in MP4, which Chromium decodes; `-allow_sw 1` lets VideoToolbox fall back to its
// software encoder on a runner without a hardware one.
const encodeArgs = (output: string): string[] => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=24',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=48000',
  '-t',
  `${CLIP_SECONDS}`,
  '-c:v',
  'h264_videotoolbox',
  '-allow_sw',
  '1',
  '-b:v',
  '1M',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-movflags',
  '+faststart',
  output,
]

type RunProps = { binary: string; args: string[]; output: string }

const run = ({ binary, args, output }: RunProps) =>
  new Promise<void>((resolve, reject) => {
    execFile(binary, args, (error, _stdout, stderr) => {
      if (error === null) return resolve()
      const detail = stderr.trim() === '' ? error.message : stderr.trim()
      reject(new Error(`${binary} could not make the e2e clip ${output}: ${detail}`))
    })
  })

type EncodeProps = { binary: string; output: string }

const encode = ({ binary, output }: EncodeProps): Promise<void> =>
  run({ binary, args: encodeArgs(output), output })

const ffmpegBinary = () => process.env.RAVEN_E2E_FFMPEG ?? 'ffmpeg'

/**
 * Two 30 second clips in a fresh temp folder, beside the decoys a real folder holds: an
 * AppleDouble sidecar that sorts between them and a text file. The second name carries a
 * space and an accent, which must survive the trip to the page.
 */
export const makeClips = async (): Promise<Clips> => {
  const binary = ffmpegBinary()
  const folder = await mkdtemp(join(tmpdir(), 'raven-e2e-clips-'))
  const first = join(folder, 'Clip 01.mp4')
  const second = join(folder, 'Clip 02 Été.mp4')
  await Promise.all([
    encode({ binary, output: first }),
    encode({ binary, output: second }),
    writeFile(join(folder, '._Clip 01b.mp4'), 'Mac OS X'),
    writeFile(join(folder, 'notes.txt'), 'not a video'),
  ]).catch(async (error: unknown) => {
    await rm(folder, { recursive: true, force: true })
    throw error
  })
  return { folder, first, second }
}

type TrackArgsProps = { subtitles: string; output: string }

// The same encoders `@raven/mpv`'s native test uses, all built into ffmpeg.
const trackArgs = ({ subtitles, output }: TrackArgsProps): string[] => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x180:rate=24',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=48000',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=880:sample_rate=48000',
  '-i',
  subtitles,
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-map',
  '2:a',
  '-map',
  '3:s',
  '-t',
  `${CLIP_SECONDS}`,
  '-c:v',
  'mpeg4',
  '-c:a',
  'aac',
  '-c:s',
  'srt',
  '-metadata:s:a:0',
  'language=eng',
  '-metadata:s:a:1',
  'language=fra',
  '-metadata:s:s:0',
  'language=eng',
  output,
]

/**
 * A 30 second MKV with two audio tracks (English, French) and an embedded English
 * subtitle, beside `notes.mkv`, a text file named like a video. The subtitle source is
 * named apart from the clip so mpv does not also load it as a sidecar.
 */
export const makeTrackClip = async (): Promise<{ folder: string; path: string }> => {
  const binary = ffmpegBinary()
  const folder = await mkdtemp(join(tmpdir(), 'raven-native-clips-'))
  const path = join(folder, 'Tracks 01.mkv')
  const subtitles = join(folder, 'source.srt')
  try {
    await Promise.all([
      writeFile(subtitles, '1\n00:00:00,000 --> 00:00:29,000\nraven track fixture\n'),
      writeFile(join(folder, 'notes.mkv'), 'not a video'),
    ])
    await run({ binary, args: trackArgs({ subtitles, output: path }), output: path })
  } catch (error) {
    await rm(folder, { recursive: true, force: true })
    throw error
  }
  return { folder, path }
}
