import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  adHocApps,
  APP_ICON,
  WINDOWS_ICON,
  FUSES,
  isPackagedPath,
  signingFrom,
} from '@/build/forgeOptions'

describe('FUSES', () => {
  it('turns off Node entry points and keeps the app to its checked asar', () => {
    expect(FUSES).toEqual({
      RunAsNode: false,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      EnableEmbeddedAsarIntegrityValidation: true,
      OnlyLoadAppFromAsar: true,
      EnableCookieEncryption: true,
    })
  })
})

describe('signingFrom', () => {
  it('signs ad hoc when no identity is set', () => {
    expect(signingFrom({})).toEqual({})
    expect(signingFrom({ RAVEN_SIGN_IDENTITY: '' })).toEqual({})
  })

  it('does not notarize without an identity', () => {
    expect(signingFrom({ RAVEN_NOTARIZE_PROFILE: 'raven' })).toEqual({})
  })

  it('signs with the identity alone', () => {
    expect(signingFrom({ RAVEN_SIGN_IDENTITY: 'Developer ID Application: CJ' })).toEqual({
      osxSign: { identity: 'Developer ID Application: CJ' },
    })
  })

  it('signs and notarizes when both are set', () => {
    expect(
      signingFrom({
        RAVEN_SIGN_IDENTITY: 'Developer ID Application: CJ',
        RAVEN_NOTARIZE_PROFILE: 'raven',
      }),
    ).toEqual({
      osxSign: { identity: 'Developer ID Application: CJ' },
      osxNotarize: { keychainProfile: 'raven' },
    })
  })
})

describe('adHocApps', () => {
  const outputPaths = ['/o/Raven-darwin-arm64']

  it('signs each packaged app ad hoc on macOS without an identity', () => {
    expect(adHocApps({ platform: 'darwin', signing: {}, outputPaths, appName: 'Raven' })).toEqual([
      '/o/Raven-darwin-arm64/Raven.app',
    ])
  })

  it('signs nothing ad hoc when an identity signs the app', () => {
    expect(
      adHocApps({
        platform: 'darwin',
        signing: { osxSign: { identity: 'Developer ID Application: Someone' } },
        outputPaths,
        appName: 'Raven',
      }),
    ).toEqual([])
  })

  it('signs nothing off macOS', () => {
    expect(adHocApps({ platform: 'linux', signing: {}, outputPaths, appName: 'Raven' })).toEqual([])
    expect(
      adHocApps({
        platform: 'win32',
        signing: {},
        outputPaths: ['/o/Raven-win32-x64'],
        appName: 'Raven',
      }),
    ).toEqual([])
  })
})

describe('APP_ICON', () => {
  const project = join(import.meta.dir, '..', '..')

  it.each(['icns', 'icon', 'ico', 'png'])('is a .%s the app ships with', (extension) => {
    expect(existsSync(join(project, `${APP_ICON}.${extension}`))).toBe(true)
  })
})

describe('WINDOWS_ICON', () => {
  it("is the .ico beside the app icon, which Squirrel's setup exe shows", () => {
    expect(WINDOWS_ICON).toBe(`${APP_ICON}.ico`)
  })
})

describe('isPackagedPath', () => {
  it.each(['', '/package.json', '/dist', '/dist/main/main.js', '/dist/preload/preload.cjs'])(
    'packages %p',
    (file) => {
      expect(isPackagedPath(file)).toBe(true)
    },
  )

  it.each([
    '/node_modules',
    '/node_modules/react/index.js',
    '/src',
    '/src/main/main.ts',
    '/e2e/harness.ts',
    '/out/make',
    '/forge.config.ts',
    '/distant',
  ])('leaves out %p', (file) => {
    expect(isPackagedPath(file)).toBe(false)
  })
})
