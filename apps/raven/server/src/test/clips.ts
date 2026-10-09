import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Encodes a short test-pattern clip with a tone, so the suite exercises the
 * real ffprobe and ffmpeg rather than fixtures. `audio` picks the audio
 * codec: aac plays anywhere, ac3 is what browsers refuse.
 */
export const encodeClip = async ({
  path,
  seconds = 6,
  audio = 'aac',
}: {
  path: string
  seconds?: number
  audio?: 'aac' | 'ac3'
}): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
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
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    audio,
    '-shortest',
    path,
  ])
}

/**
 * An MKV like a remux in miniature: a keyframe every two seconds, English
 * AC-3 audio (the default) and a Japanese AAC commentary, and an English
 * SRT track holding `cues`.
 */
export const encodeRichClip = async ({
  path,
  seconds = 30,
  cues,
}: {
  path: string
  seconds?: number
  cues: string
}): Promise<void> => {
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
