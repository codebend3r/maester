import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DMG_TOOLS,
  dmgFileName,
  hdiutilArgs,
  MakerDmg,
  makeDmg,
  PLATFORMS,
  versionOf,
} from '@/build/dmgMaker'

describe('dmgFileName', () => {
  it('names the dmg without spaces, by version and arch', () => {
    expect(dmgFileName({ version: '0.5.4', arch: 'arm64' })).toBe('raven-player-0.5.4-arm64.dmg')
  })
})

describe('hdiutilArgs', () => {
  it('creates a compressed image of the staging folder, replacing an old one', () => {
    expect(
      hdiutilArgs({
        volumeName: 'Raven',
        sourceDir: '/t/stage',
        output: '/o/make/dmg/darwin/arm64/raven-player-0.5.4-arm64.dmg',
      }),
    ).toEqual([
      'create',
      '-volname',
      'Raven',
      '-srcfolder',
      '/t/stage',
      '-format',
      'UDZO',
      '-ov',
      '/o/make/dmg/darwin/arm64/raven-player-0.5.4-arm64.dmg',
    ])
  })
})

describe('versionOf', () => {
  it('reads the version from package.json', () => {
    expect(versionOf({ version: '0.5.4' })).toBe('0.5.4')
  })

  it('throws when there is no version', () => {
    expect(() => versionOf({})).toThrow('package.json has no version')
  })

  it('throws when package.json is not an object', () => {
    expect(() => versionOf(null)).toThrow('package.json has no version')
  })

  it('throws when the version is empty or not a string', () => {
    expect(() => versionOf({ version: '' })).toThrow('package.json has no version')
    expect(() => versionOf({ version: 5 })).toThrow('package.json has no version')
  })
})

describe('MakerDmg', () => {
  it('is the dmg maker, for macOS', () => {
    const maker = new MakerDmg({}, ['darwin'])
    expect(maker.name).toBe('dmg')
    expect(maker.defaultPlatforms).toEqual(['darwin'])
    expect(maker.platforms).toEqual(['darwin'])
  })

  it('needs ditto and hdiutil', () => {
    expect(new MakerDmg({}, ['darwin']).requiredExternalBinaries).toEqual(['ditto', 'hdiutil'])
  })

  it('runs only on macOS', () => {
    expect(new MakerDmg({}, ['darwin']).isSupportedOnCurrentPlatform()).toBe(
      process.platform === PLATFORMS.darwin,
    )
  })
})

describe('makeDmg', () => {
  let makeDir = ''

  beforeEach(async () => {
    makeDir = await mkdtemp(join(tmpdir(), 'raven-make-'))
  })

  afterEach(async () => {
    await rm(makeDir, { recursive: true, force: true })
  })

  const options = () => ({
    dir: '/o/Raven-darwin-arm64',
    makeDir,
    appName: 'Raven',
    packageJSON: { version: '0.5.4' },
    targetArch: 'arm64',
  })
  const output = () => join(makeDir, 'dmg', 'darwin', 'arm64', 'raven-player-0.5.4-arm64.dmg')

  it('copies the app beside an Applications link, then makes the image from them', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const links: string[] = []
    const made = await makeDmg({
      ...options(),
      run: async ({ command, args }) => {
        calls.push({ command, args })
        if (command === DMG_TOOLS.hdiutil) {
          links.push(await readlink(join(args[4] ?? '', 'Applications')))
        }
      },
    })
    expect(made).toEqual([output()])
    const stage = dirname(calls[0]?.args[1] ?? '')
    expect(calls).toEqual([
      {
        command: 'ditto',
        args: ['/o/Raven-darwin-arm64/Raven.app', join(stage, 'Raven.app')],
      },
      {
        command: 'hdiutil',
        args: hdiutilArgs({ volumeName: 'Raven', sourceDir: stage, output: output() }),
      },
    ])
    expect(links).toEqual(['/Applications'])
    expect(existsSync(stage)).toBe(false)
    expect(existsSync(dirname(output()))).toBe(true)
  })

  it('removes the staging folder when hdiutil fails', async () => {
    const stages: string[] = []
    const making = makeDmg({
      ...options(),
      run: async ({ command, args }) => {
        if (command === DMG_TOOLS.ditto) stages.push(dirname(args[1] ?? ''))
        if (command === DMG_TOOLS.hdiutil) throw new Error('hdiutil: create failed')
      },
    })
    await expect(making).rejects.toThrow('hdiutil: create failed')
    expect(stages).toHaveLength(1)
    expect(existsSync(stages[0] ?? '')).toBe(false)
  })
})
