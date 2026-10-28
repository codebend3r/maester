import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { NATIVE_TARGETS } from '@raven/mpv'
import {
  MPV_FILES,
  MPV_MACH_O,
  MPV_PE,
  missingMpvFiles,
  STAGE_TARGETS,
  type StageTarget,
  stagedPathsFor,
  stageMpv,
  stageTargetOf,
} from '@/build/stageMpv'

const RESOURCES = '/repo/libs/raven/mpv/resources'
const STAGING = '/repo/apps/raven/desktop/staging/mpv'

type FakeFsProps = { from: string; absent: readonly string[] }

const fakeFs = ({ from, absent }: FakeFsProps) => {
  const calls: string[] = []
  type FsCopyProps = { from: string; to: string }

  return {
    calls,
    fs: {
      exists: (path: string) => !absent.some((relative) => path === join(from, relative)),
      remove: async (path: string) => {
        calls.push(`remove ${path}`)
      },
      copy: async ({ from: source, to }: FsCopyProps) => {
        calls.push(`copy ${source} -> ${to}`)
      },
    },
  }
}

describe('STAGE_TARGETS', () => {
  it("names the same targets as @raven/mpv's NATIVE_TARGETS", () => {
    expect(STAGE_TARGETS).toEqual(NATIVE_TARGETS)
  })
})

describe('stageTargetOf', () => {
  it('stages darwin-arm64 on an Apple Silicon Mac and win32-x64 on x64 Windows', () => {
    expect(stageTargetOf({ platform: 'darwin', arch: 'arm64' })).toBe(STAGE_TARGETS.darwinArm64)
    expect(stageTargetOf({ platform: 'win32', arch: 'x64' })).toBe(STAGE_TARGETS.win32X64)
  })

  it('has no target for an Intel Mac, Windows on Arm or Linux', () => {
    expect(stageTargetOf({ platform: 'darwin', arch: 'x64' })).toBeNull()
    expect(stageTargetOf({ platform: 'win32', arch: 'arm64' })).toBeNull()
    expect(stageTargetOf({ platform: 'linux', arch: 'x64' })).toBeNull()
  })
})

describe('stagedPathsFor', () => {
  it('stages the addon, both dylibs and the provenance on macOS', () => {
    expect(stagedPathsFor({ target: STAGE_TARGETS.darwinArm64 })).toEqual([
      'raven_mpv.node',
      'lib/libmpv.2.dylib',
      'lib/libMoltenVK.dylib',
      'provenance',
    ])
  })

  it('stages the addon, the DLL and the provenance on Windows', () => {
    expect(stagedPathsFor({ target: STAGE_TARGETS.win32X64 })).toEqual([
      'raven_mpv.node',
      'libmpv-2.dll',
      'provenance',
    ])
  })
})

describe('missingMpvFiles', () => {
  it('is empty when every binary is there', () => {
    expect(missingMpvFiles({ target: STAGE_TARGETS.darwinArm64, exists: () => true })).toEqual([])
    expect(missingMpvFiles({ target: STAGE_TARGETS.win32X64, exists: () => true })).toEqual([])
  })

  it('names the Mach-O files that are not there', () => {
    expect(
      missingMpvFiles({
        target: STAGE_TARGETS.darwinArm64,
        exists: (relative) => relative !== MPV_FILES.moltenVk,
      }),
    ).toEqual(['lib/libMoltenVK.dylib'])
  })

  it('checks the addon and both dylibs on macOS, and the addon and the DLL on Windows', () => {
    expect(missingMpvFiles({ target: STAGE_TARGETS.darwinArm64, exists: () => false })).toEqual([
      ...MPV_MACH_O,
    ])
    expect(missingMpvFiles({ target: STAGE_TARGETS.win32X64, exists: () => false })).toEqual([
      ...MPV_PE,
    ])
  })
})

describe('stageMpv', () => {
  it('refuses to stage without the video engine, naming what is missing, and copies nothing', async () => {
    const from = join(RESOURCES, STAGE_TARGETS.darwinArm64)
    const { calls, fs } = fakeFs({ from, absent: ['lib/libMoltenVK.dylib'] })
    await expect(
      stageMpv({ target: STAGE_TARGETS.darwinArm64, from, staging: STAGING, fs }),
    ).rejects.toThrow(
      `Raven packages the video engine, and these are missing from ${from}: lib/libMoltenVK.dylib. CI builds them (bunx nx run @raven/mpv:build:native).`,
    )
    expect(calls).toEqual([])
  })

  it('names the Windows build when the DLL is missing', async () => {
    const from = join(RESOURCES, STAGE_TARGETS.win32X64)
    const { calls, fs } = fakeFs({ from, absent: ['libmpv-2.dll'] })
    await expect(
      stageMpv({ target: STAGE_TARGETS.win32X64, from, staging: STAGING, fs }),
    ).rejects.toThrow(
      `Raven packages the video engine, and these are missing from ${from}: libmpv-2.dll. CI builds them (bunx nx run @raven/mpv:build:native:windows).`,
    )
    expect(calls).toEqual([])
  })

  it.each([STAGE_TARGETS.darwinArm64, STAGE_TARGETS.win32X64])(
    'clears the whole staging folder, then copies %s into its own folder in order',
    async (target: StageTarget) => {
      const from = join(RESOURCES, target)
      const { calls, fs } = fakeFs({ from, absent: [] })
      await stageMpv({ target, from, staging: STAGING, fs })
      expect(calls).toEqual([
        `remove ${STAGING}`,
        ...stagedPathsFor({ target }).map(
          (path) => `copy ${join(from, path)} -> ${join(STAGING, target, path)}`,
        ),
      ])
    },
  )

  it('copies one path at a time', async () => {
    const from = join(RESOURCES, STAGE_TARGETS.darwinArm64)
    const order: string[] = []
    type CopyProps = { from: string; to: string }

    const fs = {
      exists: () => true,
      remove: async () => {},
      copy: async ({ from: source }: CopyProps) => {
        order.push(`start ${source}`)
        await Promise.resolve()
        order.push(`end ${source}`)
      },
    }
    await stageMpv({ target: STAGE_TARGETS.darwinArm64, from, staging: STAGING, fs })
    expect(order).toEqual(
      stagedPathsFor({ target: STAGE_TARGETS.darwinArm64 }).flatMap((path) => [
        `start ${join(from, path)}`,
        `end ${join(from, path)}`,
      ]),
    )
  })
})
