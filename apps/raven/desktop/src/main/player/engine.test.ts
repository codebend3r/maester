import { expect, test } from 'bun:test'
import type { MpvSurface } from '@raven/mpv'
import {
  addonPathFor,
  ENGINE_MESSAGES,
  engineModeFrom,
  engineOptionsFor,
  HARDENED_OPTIONS,
  HEADLESS_OPTIONS,
  openEngine,
} from '@/main/player/engine'

test('engineModeFrom', () => {
  const cases = [
    { isPackaged: true, env: { RAVEN_DESKTOP_MPV: 'headless' }, expected: 'window' },
    { isPackaged: true, env: { RAVEN_DESKTOP_MPV: 'off' }, expected: 'window' },
    { isPackaged: false, env: {}, expected: 'window' },
    { isPackaged: false, env: { RAVEN_DESKTOP_MPV: 'headless' }, expected: 'headless' },
    { isPackaged: false, env: { RAVEN_DESKTOP_MPV: 'off' }, expected: 'off' },
    { isPackaged: false, env: { RAVEN_DESKTOP_MPV: 'bogus' }, expected: 'window' },
    { isPackaged: false, env: { RAVEN_DESKTOP_MPV: undefined }, expected: 'window' },
  ] as const
  cases.forEach(({ isPackaged, env, expected }) => {
    expect(engineModeFrom({ isPackaged, env })).toBe(expected)
  })
})

test('HARDENED_OPTIONS stops mpv following references out of a granted file', () => {
  expect(HARDENED_OPTIONS).toEqual([{ name: 'access-references', value: false }])
})

test('HEADLESS_OPTIONS paces the null output like a 60 Hz display', () => {
  expect(HEADLESS_OPTIONS).toEqual([{ name: 'vo-null-fps', value: 60 }])
})

test('engineOptionsFor paces only the headless output; a window gets nothing', () => {
  expect(engineOptionsFor({ surface: { kind: 'headless' } })).toEqual(HEADLESS_OPTIONS)
  expect(engineOptionsFor({ surface: { kind: 'window', handle: Buffer.alloc(8) } })).toEqual([])
})

test('addonPathFor', () => {
  expect(
    addonPathFor({
      isPackaged: false,
      appPath: '/repo/apps/raven/desktop',
      resourcesPath: '/Applications/Raven.app/Contents/Resources',
    }),
  ).toBe('/repo/libs/raven/mpv/resources/darwin-arm64/raven_mpv.node')
  expect(
    addonPathFor({
      isPackaged: true,
      appPath: '/Applications/Raven.app/Contents/Resources/app.asar',
      resourcesPath: '/Applications/Raven.app/Contents/Resources',
    }),
  ).toBe('/Applications/Raven.app/Contents/Resources/mpv/darwin-arm64/raven_mpv.node')
})

const windowSurface: MpvSurface = { kind: 'window', handle: Buffer.alloc(8) }
const headlessSurface: MpvSurface = { kind: 'headless' }

test('off never opens', async () => {
  const opened: MpvSurface[] = []
  const result = await openEngine({
    mode: 'off',
    surfaceFor: () => windowSurface,
    open: async (surface) => {
      opened.push(surface)
      return 'engine'
    },
    warn: () => {},
  })
  expect(result).toEqual({ status: 'unavailable', message: ENGINE_MESSAGES.off })
  expect(opened).toEqual([])
})

test('a rejecting open is warned and unavailable', async () => {
  const warnings: string[] = []
  const result = await openEngine({
    mode: 'window',
    surfaceFor: () => windowSurface,
    open: () => Promise.reject(new Error('addon missing')),
    warn: (message) => warnings.push(message),
  })
  expect(result).toEqual({ status: 'unavailable', message: ENGINE_MESSAGES.unavailable })
  expect(warnings).toEqual(['addon missing'])
})

test('a throwing open is warned and unavailable', async () => {
  const warnings: string[] = []
  const result = await openEngine({
    mode: 'window',
    surfaceFor: () => windowSurface,
    open: () => {
      throw new Error('sync boom')
    },
    warn: (message) => warnings.push(message),
  })
  expect(result).toEqual({ status: 'unavailable', message: ENGINE_MESSAGES.unavailable })
  expect(warnings).toEqual(['sync boom'])
})

test('a throwing surfaceFor is warned and unavailable', async () => {
  const warnings: string[] = []
  const result = await openEngine({
    mode: 'window',
    surfaceFor: () => {
      throw new Error('no window')
    },
    open: async () => 'engine',
    warn: (message) => warnings.push(message),
  })
  expect(result).toEqual({ status: 'unavailable', message: ENGINE_MESSAGES.unavailable })
  expect(warnings).toEqual(['no window'])
})

test('a non-Error rejection is warned as text', async () => {
  const warnings: string[] = []
  await openEngine({
    mode: 'window',
    surfaceFor: () => windowSurface,
    open: () => Promise.reject('plain'),
    warn: (message) => warnings.push(message),
  })
  expect(warnings).toEqual(['plain'])
})

test('a resolving open is native and headless asks for the headless surface', async () => {
  const modes: string[] = []
  const result = await openEngine({
    mode: 'headless',
    surfaceFor: (mode) => {
      modes.push(mode)
      return headlessSurface
    },
    open: async (surface) => ({ surface }),
    warn: () => {},
  })
  expect(result).toEqual({ status: 'native', engine: { surface: headlessSurface } })
  expect(modes).toEqual(['headless'])
})
