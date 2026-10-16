import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Clips = { folder: string; first: string; second: string }

const CLIP_SECONDS = 30

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

const encode = ({ binary, output }: { binary: string; output: string }): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(binary, encodeArgs(output), (error, _stdout, stderr) => {
      if (error === null) return resolve()
      const detail = stderr.trim() === '' ? error.message : stderr.trim()
      reject(new Error(`${binary} could not make the e2e clip ${output}: ${detail}`))
    })
  })

/**
 * Two 30 second clips in a fresh temp folder, beside the decoys a real folder holds: an
 * AppleDouble sidecar that sorts between them and a text file. The second name carries a
 * space and an accent, which must survive the trip to the page.
 */
export const makeClips = async (): Promise<Clips> => {
  const binary = process.env.RAVEN_E2E_FFMPEG ?? 'ffmpeg'
  const folder = await mkdtemp(join(tmpdir(), 'raven-e2e-clips-'))
  const first = join(folder, 'Clip 01.mp4')
  const second = join(folder, 'Clip 02 Été.mp4')
  await Promise.all([
    encode({ binary, output: first }),
    encode({ binary, output: second }),
    writeFile(join(folder, '._Clip 01b.mp4'), 'Mac OS X'),
    writeFile(join(folder, 'notes.txt'), 'not a video'),
  ])
  return { folder, first, second }
}
