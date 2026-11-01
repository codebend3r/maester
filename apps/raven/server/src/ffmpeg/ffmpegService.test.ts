import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readServerConfig } from '@/config'
import { DEFAULT_PLAYBACK_SETTINGS, type HwAccel } from '@raven/core'
import { FfmpegService, FfmpegTimeoutError } from '@/ffmpeg/ffmpegService'
import { ScanControl } from '@/scanner/scanControl'
import { RUN_EVENTS, RUN_SIGNALS } from '@/hls/segmentRun'

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
    // A Debian ffmpeg beside a Homebrew ffprobe.
    await writeFile(
      join(state.dir, 'ffmpeg-5'),
      '#!/bin/sh\necho "ffmpeg version 5.1.9-0+deb12u1 Copyright"\n',
    )
    await writeFile(
      join(state.dir, 'ffprobe-9'),
      '#!/bin/sh\necho "ffprobe version 9.0.2 Copyright"\n',
    )
    await chmod(join(state.dir, 'ffmpeg-5'), 0o755)
    await chmod(join(state.dir, 'ffprobe-9'), 0o755)
    await writeFile(join(state.dir, 'renderD128'), '')
    // Prints its arguments, then two raw fingerprint points: 1 and 0xffffffff.
    await writeFile(
      join(state.dir, 'chromaprint'),
      '#!/bin/sh\necho "$@" > "$0.args"\nprintf "\\001\\000\\000\\000\\377\\377\\377\\377"\n',
    )
    await chmod(join(state.dir, 'chromaprint'), 0o755)
    // Prints its arguments, then one frame's statistics as `metadata=mode=print` does.
    await writeFile(
      join(state.dir, 'pictures'),
      '#!/bin/sh\necho "$@" > "$0.args"\nprintf "frame:0    pts:0       pts_time:0\\nlavfi.signalstats.SATAVG=1.5\\nlavfi.blackframe.pblack=88\\n"\n',
    )
    await chmod(join(state.dir, 'pictures'), 0o755)
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
        keyframeProbeTimeoutSeconds: 1,
        markerTimeoutSeconds: 1,
      },
      { playback: () => DEFAULT_PLAYBACK_SETTINGS },
      new ScanControl(),
    )

  it('warns at start when ffmpeg and ffprobe are different builds', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      await new FfmpegService(
        {
          ...readServerConfig({}),
          ffmpegPath: join(state.dir, 'ffmpeg-5'),
          ffprobePath: join(state.dir, 'ffprobe-9'),
        },
        { playback: () => DEFAULT_PLAYBACK_SETTINGS },
        new ScanControl(),
      ).warnOfMismatchedTools()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ffmpeg is 5.1.9-0+deb12u1 and ffprobe is 9.0.2'),
      )
    } finally {
      warn.mockRestore()
    }
  })

  // Both wait out the same second, side by side.
  it('reports a timeout as a timeout, so the scan can retry later', async () => {
    await Promise.all([
      expect(service('slow').probeFile('/media/a.mkv')).rejects.toBeInstanceOf(FfmpegTimeoutError),
      expect(service('slow').exec(['-version'])).rejects.toThrow('ffmpeg gave up after 1s'),
    ])
  })

  it('kills a segment run still going when the server stops', async () => {
    const ffmpeg = service('slow')
    const child = ffmpeg.segment([])
    const closed = new Promise<NodeJS.Signals | null>((resolve) => {
      child.on(RUN_EVENTS.close, (_code, signal) => resolve(signal))
    })

    ffmpeg.onModuleDestroy()

    expect(await closed).toBe(RUN_SIGNALS.kill)
  })

  it("passes on ffprobe's own reason for a broken file", async () => {
    const failure = service('broken').probeFile('/media/a.mkv')
    await expect(failure).rejects.toThrow('Invalid data found when processing input')
    await expect(failure).rejects.not.toBeInstanceOf(FfmpegTimeoutError)
  })

  it("reads a file's head as raw Chromaprint points, four bytes each, from its first audio track", async () => {
    const points = await service('chromaprint').fingerprint({
      path: '/m/a.mkv',
      start: 0,
      seconds: 600,
    })
    expect(points).toEqual([1, 0xffffffff])
    const args = await readFile(join(state.dir, 'chromaprint.args'), 'utf8')
    expect(args).toContain(
      '-ss 0 -t 600 -i /m/a.mkv -map 0:a:0 -ac 1 -f chromaprint -fp_format raw -',
    )
  })

  it("scores a film's tail a frame a second, from its keyframes", async () => {
    expect(await service('pictures').pictureStats({ path: '/m/a.mkv', start: 6300 })).toEqual([
      { at: 6300, saturation: 1.5, dark: 88 },
    ])
    const args = await readFile(join(state.dir, 'pictures.args'), 'utf8')
    expect(args).toContain('-skip_frame nokey -ss 6300 -i /m/a.mkv -map 0:v:0 -an -sn -vf fps=1,')
  })

  it("reports a fingerprint run's failure and timeout as the other runs do", async () => {
    await expect(
      service('broken').fingerprint({ path: '/m/a.mkv', start: 0, seconds: 600 }),
    ).rejects.toThrow('Invalid data found when processing input')
    await expect(
      service('slow').fingerprint({ path: '/m/a.mkv', start: 0, seconds: 600 }),
    ).rejects.toBeInstanceOf(FfmpegTimeoutError)
  })

  it("lists a file's video keyframes from ffprobe's packets, without decoding", async () => {
    expect(await service('packets').probeKeyframes('/media/a.mkv')).toEqual([0, 2])
    expect(await readFile(join(state.dir, 'packets.args'), 'utf8')).toBe(
      '-v error -select_streams V:0 -show_entries packet=pts_time,flags -of csv=p=0 /media/a.mkv\n',
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

  it('gives the keyframe probe its own, longer time limit than a header probe', async () => {
    await writeFile(join(state.dir, 'sleepy'), '#!/bin/sh\nsleep 2\nprintf "0.000000,K__\\n"\n')
    await chmod(join(state.dir, 'sleepy'), 0o755)
    const sleepy = new FfmpegService(
      {
        ...readServerConfig({}),
        ffprobePath: join(state.dir, 'sleepy'),
        ffmpegTimeoutSeconds: 1,
        keyframeProbeTimeoutSeconds: 10,
      },
      { playback: () => DEFAULT_PLAYBACK_SETTINGS },
      new ScanControl(),
    )

    expect(await sleepy.probeKeyframes('/media/a.mkv')).toEqual([0])
    await expect(sleepy.probeJson('/media/a.mkv')).rejects.toBeInstanceOf(FfmpegTimeoutError)
  })

  describe('choosing how transcodes encode', () => {
    type EncoderWithProps = { tool: string; hwAccel: HwAccel }

    const encoderWith = ({ tool, hwAccel }: EncoderWithProps) =>
      new FfmpegService(
        {
          ...readServerConfig({}),
          ffmpegPath: join(state.dir, tool),
          hwAccel,
          vaapiDevice: join(state.dir, 'renderD128'),
        },
        { playback: () => DEFAULT_PLAYBACK_SETTINGS },
        new ScanControl(),
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
