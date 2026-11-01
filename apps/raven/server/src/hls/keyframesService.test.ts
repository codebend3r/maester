import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_PLAYBACK_SETTINGS, LIBRARY_KINDS } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { ScanControl } from '@/scanner/scanControl'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { KeyframesService } from '@/hls/keyframesService'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { encodeRichClip } from '@/test/clips'
import { testDatabase } from '@/test/database'

/** ffprobe as the service runs it, counting the keyframe probes that started. */
class CountingFfmpeg extends FfmpegService {
  probes = 0

  override async probeKeyframes(path: string): Promise<number[]> {
    this.probes += 1
    return super.probeKeyframes(path)
  }
}

/** A probe that answers only once the test lets it, so a file can change while it runs. */
class GatedFfmpeg extends FfmpegService {
  probes = 0
  release: () => void = () => undefined
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve
  })

  override async probeKeyframes(): Promise<number[]> {
    this.probes += 1
    await this.gate
    return [0, 9]
  }
}

describe('KeyframesService', () => {
  const database = testDatabase('raven-keyframes-')
  const state = { libraryId: 0, count: 0 }
  const index = () => new MediaIndex(database.get())
  const add = (name: string): number =>
    index().insert({
      libraryId: state.libraryId,
      kind: LIBRARY_KINDS.other,
      file: { path: join(database.dir(), name), root: database.dir(), size: 1, mtimeMs: 1 },
    })
  const serviceWith = (ffprobePath: string) => {
    const ffmpeg = new CountingFfmpeg(
      { ...readServerConfig({}), ffprobePath },
      { playback: () => DEFAULT_PLAYBACK_SETTINGS },
      new ScanControl(),
    )
    return { ffmpeg, keyframes: new KeyframesService(ffmpeg, index()) }
  }

  beforeAll(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Test',
      paths: [database.dir()],
    }).id
  })

  afterAll(database.close)

  it('probes a ten-second clip with a keyframe every two seconds, and saves them', async () => {
    const path = join(database.dir(), 'Rich.mkv')
    await encodeRichClip({ path, seconds: 10, cues: '1\n00:00:01,000 --> 00:00:02,000\nHi\n' })
    const id = add('Clip.mkv')
    const { keyframes } = serviceWith('ffprobe')

    const found = await keyframes.of({ id, path })
    expect(found).toHaveLength(5)
    ;[0, 2, 4, 6, 8].forEach((time, position) => {
      expect(found[position]).toBeCloseTo(time, 1)
    })
    expect(index().storedKeyframes(id)).toEqual(found)
  })

  it('stores a probe truncated to three decimals, not rounded', async () => {
    const script = join(database.dir(), 'ffprobe-fake')
    await writeFile(
      script,
      '#!/bin/sh\nprintf "79.996583,K__\\n0.000000,K__\\n30.488792,K__\\n31.000000,___\\n"\n',
    )
    await chmod(script, 0o755)
    const id = add('Fake.mkv')
    const { keyframes } = serviceWith(script)

    expect(await keyframes.of({ id, path: '/m/fake.mkv' })).toEqual([0, 30.488, 79.996])
    expect(index().storedKeyframes(id)).toEqual([0, 30.488, 79.996])
  })

  it('answers from the stored keyframes without another probe', async () => {
    const id = add('Kept.mkv')
    index().saveKeyframes({ id, keyframes: [0, 5] })
    const { ffmpeg, keyframes } = serviceWith('ffprobe-that-does-not-exist')

    expect(await keyframes.of({ id, path: '/m/kept.mkv' })).toEqual([0, 5])
    expect(ffmpeg.probes).toBe(0)
  })

  it('probes once for a file asked about twice, in a row or at once', async () => {
    const path = join(database.dir(), 'Rich.mkv')
    const id = add('Twice.mkv')
    const { ffmpeg, keyframes } = serviceWith('ffprobe')

    const [first, second] = await Promise.all([
      keyframes.of({ id, path }),
      keyframes.of({ id, path }),
    ])
    expect(second).toEqual(first)
    expect(ffmpeg.probes).toBe(1)
    await keyframes.of({ id, path })
    expect(ffmpeg.probes).toBe(1)
  })

  it('probes again once the file changed', async () => {
    const path = join(database.dir(), 'Rich.mkv')
    const id = add('Changed.mkv')
    const { ffmpeg, keyframes } = serviceWith('ffprobe')

    await keyframes.of({ id, path })
    index().markChanged({ id, size: 2, mtimeMs: 2 })
    await keyframes.of({ id, path })
    expect(ffmpeg.probes).toBe(2)
  })

  it('does not keep a failed probe, so the next call tries again', async () => {
    const id = add('Broken.mkv')
    const { ffmpeg, keyframes } = serviceWith('ffprobe')

    await expect(keyframes.of({ id, path: join(database.dir(), 'missing.mkv') })).rejects.toThrow()
    await expect(keyframes.of({ id, path: join(database.dir(), 'missing.mkv') })).rejects.toThrow()
    expect(ffmpeg.probes).toBe(2)
    expect(index().storedKeyframes(id)).toBeNull()
  })

  const gated = () => {
    const ffmpeg = new GatedFfmpeg(
      readServerConfig({}),
      {
        playback: () => DEFAULT_PLAYBACK_SETTINGS,
      },
      new ScanControl(),
    )
    return { ffmpeg, keyframes: new KeyframesService(ffmpeg, index()) }
  }

  it('keeps nothing from a probe that began before the file changed', async () => {
    const id = add('Replaced.mkv')
    const { ffmpeg, keyframes } = gated()

    const stale = keyframes.of({ id, path: '/m/replaced.mkv' })
    index().markChanged({ id, size: 2, mtimeMs: 2 })
    ffmpeg.release()
    await stale

    expect(index().storedKeyframes(id)).toBeNull()
    await keyframes.of({ id, path: '/m/replaced.mkv' })
    expect(ffmpeg.probes).toBe(2)
    expect(index().storedKeyframes(id)).toEqual([0, 9])
  })

  it('does not hand a caller after the change the probe of the old file', async () => {
    const id = add('Swapped.mkv')
    const { ffmpeg, keyframes } = gated()

    const stale = keyframes.of({ id, path: '/m/swapped.mkv' })
    index().markChanged({ id, size: 2, mtimeMs: 2 })
    const fresh = keyframes.of({ id, path: '/m/swapped.mkv' })
    ffmpeg.release()
    await Promise.all([stale, fresh])

    expect(ffmpeg.probes).toBe(2)
    expect(index().storedKeyframes(id)).toEqual([0, 9])
  })
})
