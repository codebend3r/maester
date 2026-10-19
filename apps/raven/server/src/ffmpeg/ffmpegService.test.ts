import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { DEFAULT_PLAYBACK_SETTINGS, type HwAccel } from '@raven/core'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService'

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
    await writeFile(join(state.dir, 'works'), '#!/bin/sh\nexit 0\n')
    // Prints its arguments, then three packets in decode order.
    await writeFile(
      join(state.dir, 'packets'),
      '#!/bin/sh\necho "$@" > "$0.args"\nprintf "2.000000,K__\\n0.000000,K__\\n1.000000,___\\n"\n',
    )
    await chmod(join(state.dir, 'packets'), 0o755)
    await writeFile(join(state.dir, 'renderD128'), '')
    await chmod(join(state.dir, 'works'), 0o755)
    await chmod(join(state.dir, 'slow'), 0o755)
    await chmod(join(state.dir, 'broken'), 0o755)
  })

  afterAll(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  const service = (tool: string) =>
    new FfmpegService(
      {
        ...readServerConfig({}),
        ffprobePath: join(state.dir, tool),
        ffmpegPath: join(state.dir, tool),
        ffmpegTimeoutSeconds: 1,
      },
      { playback: () => DEFAULT_PLAYBACK_SETTINGS },
    )

  // Both wait out the same second, side by side.
  it('reports a timeout as a timeout, so the scan can retry later', async () => {
    await Promise.all([
      expect(service('slow').probeFile('/media/a.mkv')).rejects.toBeInstanceOf(FfmpegTimeoutError),
      expect(service('slow').exec(['-version'])).rejects.toThrow('ffmpeg gave up after 1s'),
    ])
  })

  it("passes on ffprobe's own reason for a broken file", async () => {
    const failure = service('broken').probeFile('/media/a.mkv')
    await expect(failure).rejects.toThrow('Invalid data found when processing input')
    await expect(failure).rejects.not.toBeInstanceOf(FfmpegTimeoutError)
  })

  it("lists a file's video keyframes from ffprobe's packets, without decoding", async () => {
    expect(await service('packets').probeKeyframes('/media/a.mkv')).toEqual([0, 2])
    expect(await readFile(join(state.dir, 'packets.args'), 'utf8')).toBe(
      '-v error -select_streams v:0 -show_entries packet=pts_time,flags -of csv=p=0 /media/a.mkv\n',
    )
  })

  it("reports a keyframe probe's failure and timeout as probeFile does", async () => {
    await expect(service('broken').probeKeyframes('/media/a.mkv')).rejects.toThrow(
      'Invalid data found when processing input',
    )
    await expect(service('slow').probeKeyframes('/media/a.mkv')).rejects.toBeInstanceOf(
      FfmpegTimeoutError,
    )
  })

  describe('choosing how transcodes encode', () => {
    const encoderWith = ({ tool, hwAccel }: { tool: string; hwAccel: HwAccel }) =>
      new FfmpegService(
        {
          ...readServerConfig({}),
          ffmpegPath: join(state.dir, tool),
          hwAccel,
          vaapiDevice: join(state.dir, 'renderD128'),
        },
        { playback: () => DEFAULT_PLAYBACK_SETTINGS },
      ).videoEncoder()

    it('uses the GPU when its test encode works', async () => {
      await expect(encoderWith({ tool: 'works', hwAccel: 'vaapi' })).resolves.toEqual({
        kind: 'vaapi',
        device: join(state.dir, 'renderD128'),
      })
    })

    it('falls back to the CPU when the GPU is there but its test encode fails', async () => {
      await expect(encoderWith({ tool: 'broken', hwAccel: 'vaapi' })).resolves.toEqual({
        kind: 'software',
      })
    })

    it('stays on the CPU when hardware acceleration is off', async () => {
      await expect(encoderWith({ tool: 'works', hwAccel: 'none' })).resolves.toEqual({
        kind: 'software',
      })
    })
  })
})
