import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
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
