import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { MPV_FILES, MPV_MACH_O, missingMpvFiles, STAGED_PATHS, stageMpv } from '@/build/stageMpv'

const FROM = '/repo/libs/raven/mpv/resources/darwin-arm64'
const TO = '/repo/apps/raven/desktop/staging/mpv/darwin-arm64'

const fakeFs = ({ absent }: { absent: readonly string[] }) => {
  const calls: string[] = []
  return {
    calls,
    fs: {
      exists: (path: string) => !absent.some((relative) => path === join(FROM, relative)),
      remove: async (path: string) => {
        calls.push(`remove ${path}`)
      },
      copy: async ({ from, to }: { from: string; to: string }) => {
        calls.push(`copy ${from} -> ${to}`)
      },
    },
  }
}

describe('missingMpvFiles', () => {
  it('is empty when every Mach-O file is there', () => {
    expect(missingMpvFiles({ exists: () => true })).toEqual([])
  })

  it('names the Mach-O files that are not there', () => {
    expect(missingMpvFiles({ exists: (relative) => relative !== MPV_FILES.moltenVk })).toEqual([
      'lib/libMoltenVK.dylib',
    ])
  })

  it('checks the addon and both dylibs', () => {
    expect(missingMpvFiles({ exists: () => false })).toEqual([...MPV_MACH_O])
  })
})

describe('stageMpv', () => {
  it('refuses to stage without the video engine, naming what is missing, and copies nothing', async () => {
    const { calls, fs } = fakeFs({ absent: ['lib/libMoltenVK.dylib'] })
    await expect(stageMpv({ from: FROM, to: TO, fs })).rejects.toThrow(
      `raven player packages the video engine, and these are missing from ${FROM}: lib/libMoltenVK.dylib. CI builds them (bunx nx run @raven/mpv:build:native).`,
    )
    expect(calls).toEqual([])
  })

  it('clears the staging folder, then copies the addon, both dylibs and the provenance in order', async () => {
    const { calls, fs } = fakeFs({ absent: [] })
    await stageMpv({ from: FROM, to: TO, fs })
    expect(calls).toEqual([
      `remove ${TO}`,
      ...STAGED_PATHS.map((path) => `copy ${join(FROM, path)} -> ${join(TO, path)}`),
    ])
    expect([...STAGED_PATHS]).toEqual([
      'raven_mpv.node',
      'lib/libmpv.2.dylib',
      'lib/libMoltenVK.dylib',
      'provenance',
    ])
  })

  it('copies one path at a time', async () => {
    const order: string[] = []
    const fs = {
      exists: () => true,
      remove: async () => {},
      copy: async ({ from }: { from: string; to: string }) => {
        order.push(`start ${from}`)
        await Promise.resolve()
        order.push(`end ${from}`)
      },
    }
    await stageMpv({ from: FROM, to: TO, fs })
    expect(order).toEqual(
      STAGED_PATHS.flatMap((path) => [`start ${join(FROM, path)}`, `end ${join(FROM, path)}`]),
    )
  })
})
