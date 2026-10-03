import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config.js'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService.js'

describe('FfmpegService', () => {
  const state = { dir: '' }

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-ffmpeg-'))
    // Stands in for ffprobe on a share that never answers.
    await writeFile(join(state.dir, 'slow'), '#!/bin/sh\nsleep 5\n')
    await writeFile(
      join(state.dir, 'broken'),
      '#!/bin/sh\necho "Invalid data found when processing input" >&2\nexit 1\n',
    )
    await chmod(join(state.dir, 'slow'), 0o755)
    await chmod(join(state.dir, 'broken'), 0o755)
  })

  afterAll(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  const service = (tool: string) =>
    new FfmpegService({
      ...readServerConfig({}),
      ffprobePath: join(state.dir, tool),
      ffmpegPath: join(state.dir, tool),
      ffmpegTimeoutSeconds: 1,
    })

  it('reports a timeout as a timeout, so the scan can retry later', async () => {
    await expect(service('slow').probe('/media/a.mkv')).rejects.toBeInstanceOf(FfmpegTimeoutError)
    await expect(service('slow').exec(['-version'])).rejects.toThrow('ffmpeg gave up after 1s')
  })

  it("passes on ffprobe's own reason for a broken file", async () => {
    const failure = service('broken').probe('/media/a.mkv')
    await expect(failure).rejects.toThrow('Invalid data found when processing input')
    await expect(failure).rejects.not.toBeInstanceOf(FfmpegTimeoutError)
  })
})
