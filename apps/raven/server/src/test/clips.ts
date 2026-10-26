import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The test pattern's frames per second. */
const CLIP_FPS = 24

type EncodeClipProps = {
  path: string
  seconds?: number
  audio?: 'aac' | 'ac3'
  /** The frame size, `WIDTHxHEIGHT`. */
  size?: string
  /** Seconds between keyframes, exactly, with no scene cut adding one. */
  keyframeEvery?: number
  /** Where the file's own clock starts, in seconds, as a broadcast recording's does. */
  startAt?: number
  /** Frames per second, as ffmpeg writes a rate: `24000/1001` for NTSC film. */
  frameRate?: string
  /** How long after the sound the picture starts, as in many broadcast recordings. */
  videoDelay?: number
}

/**
 * Encodes a short test-pattern clip with a tone, so the suite exercises the
 * real ffprobe and ffmpeg rather than fixtures. `audio` picks the audio
 * codec: aac plays anywhere, ac3 is what browsers refuse.
 */
export const encodeClip = async ({
  path,
  seconds = 6,
  audio = 'aac',
  size = '320x240',
  keyframeEvery,
  startAt,
  frameRate = String(CLIP_FPS),
  videoDelay,
}: EncodeClipProps): Promise<void> => {
  const [top = CLIP_FPS, bottom = 1] = frameRate.split('/').map(Number)
  const gop = keyframeEvery == null ? null : String(Math.round((keyframeEvery * top) / bottom))
  await mkdir(dirname(path), { recursive: true })
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...(videoDelay == null ? [] : ['-itsoffset', String(videoDelay)]),
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${size}:rate=${frameRate}:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:v',
    'libx264',
    ...(gop == null ? [] : ['-g', gop, '-keyint_min', gop, '-sc_threshold', '0']),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    audio,
    '-shortest',
    ...(startAt == null ? [] : ['-output_ts_offset', String(startAt)]),
    path,
  ])
}

type EncodeRichClipProps = {
  path: string
  seconds?: number
  cues: string
  bFrames?: number
}

/**
 * An MKV like a remux in miniature: a keyframe every two seconds, English
 * AC-3 audio (the default) and a Japanese AAC commentary, and an English
 * SRT track holding `cues`. `bFrames` sets how many B-frames x264 may put
 * between references, which reorders the video so its dts runs behind its pts.
 */
export const encodeRichClip = async ({
  path,
  seconds = 30,
  cues,
  bFrames,
}: EncodeRichClipProps): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const srt = `${path}.source.srt`
  await writeFile(srt, cues)
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=320x240:rate=24:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=880:duration=${seconds}`,
    '-i',
    srt,
    '-map',
    '0',
    '-map',
    '1',
    '-map',
    '2',
    '-map',
    '3',
    '-c:v',
    'libx264',
    '-g',
    '48',
    ...(bFrames == null ? [] : ['-bf', String(bFrames)]),
    '-pix_fmt',
    'yuv420p',
    '-c:a:0',
    'ac3',
    '-c:a:1',
    'aac',
    '-c:s',
    'srt',
    '-metadata:s:a:0',
    'language=eng',
    '-metadata:s:a:1',
    'language=jpn',
    '-metadata:s:a:1',
    'title=Commentary',
    '-metadata:s:s:0',
    'language=eng',
    '-disposition:a:0',
    'default',
    '-disposition:a:1',
    '0',
    path,
  ])
  await rm(srt)
}

type EncodeImageProps = {
  path: string
  size?: string
}

/** A still picture, such as a poster beside a movie, of one flat colour. */
export const encodeImage = async ({ path, size = '200x300' }: EncodeImageProps): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=teal:s=${size}`,
    '-frames:v',
    '1',
    path,
  ])
}

/** How wide and tall a JPEG says it is, read from its frame header. */
export const jpegSize = (jpeg: Buffer): { width: number; height: number } => {
  const read = (at: number): { width: number; height: number } => {
    if (at + 9 > jpeg.length || jpeg[at] !== 0xff) throw new Error('No JPEG frame header')
    const marker = jpeg[at + 1] ?? 0
    // SOF0 to SOF3 hold the frame's size; any other segment is passed over by its length.
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7) }
    }
    return read(at + 2 + jpeg.readUInt16BE(at + 2))
  }
  return read(2)
}
