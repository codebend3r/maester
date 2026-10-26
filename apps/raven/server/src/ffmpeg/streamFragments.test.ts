import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PLAYBACK_MODES } from '@raven/core'
import { expect, it } from 'vitest'
import { streamArgs } from '@/ffmpeg/args'

const run = promisify(execFile)
const BOX_TYPES = { fragment: 'moof' } as const

type BoxesProps = { bytes: Buffer; offset?: number }

const boxes = ({ bytes, offset = 0 }: BoxesProps): string[] => {
  if (offset === bytes.length) return []
  if (offset + 8 > bytes.length) throw new Error('Incomplete MP4 box header')
  const size = bytes.readUInt32BE(offset)
  if (size < 8 || offset + size > bytes.length) throw new Error('Incomplete MP4 box')
  return [
    bytes.toString('ascii', offset + 4, offset + 8),
    ...boxes({ bytes, offset: offset + size }),
  ]
}

it('delivers one-second remux fragments even when the source keyframes are six seconds apart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'raven-fragments-'))
  try {
    const input = join(root, 'long-gop.mkv')
    await run('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=24:duration=8',
      '-f',
      'lavfi',
      '-i',
      'sine=sample_rate=48000:duration=8',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-g',
      '144',
      '-keyint_min',
      '144',
      '-sc_threshold',
      '0',
      '-c:a',
      'ac3',
      input,
    ])
    const { stdout } = await run(
      'ffmpeg',
      streamArgs({
        input,
        start: 0,
        mode: PLAYBACK_MODES.remux,
        audio: 0,
        videoCodec: 'h264',
        tonemap: false,
        streamShift: 1,
      }),
      { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 },
    )
    expect(
      boxes({ bytes: stdout }).filter((type) => type === BOX_TYPES.fragment).length,
    ).toBeGreaterThanOrEqual(8)
    const output = join(root, 'stream.mp4')
    await writeFile(output, stdout)
    const decoded = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=nb_read_frames',
      '-of',
      'csv=p=0',
      output,
    ])
    expect(decoded.stderr).toBe('')
    expect(Number(decoded.stdout.trim())).toBe(192)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
