import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fontsDirFor, subtitleLookOptions, subtitleStyleOptions } from '@/main/player/subtitleLook'

test('fontsDirFor reads the project folder unpackaged and the app resources packaged', () => {
  expect(
    fontsDirFor({
      isPackaged: false,
      appPath: '/repo/apps/raven/desktop',
      resourcesPath: '/Applications/Raven.app/Contents/Resources',
    }),
  ).toBe('/repo/apps/raven/desktop/resources/fonts')
  expect(
    fontsDirFor({
      isPackaged: true,
      appPath: '/Applications/Raven.app/Contents/Resources/app.asar',
      resourcesPath: '/Applications/Raven.app/Contents/Resources',
    }),
  ).toBe('/Applications/Raven.app/Contents/Resources/fonts')
})

test('the unpackaged fonts folder holds Young Serif', () => {
  const fontsDir = fontsDirFor({
    isPackaged: false,
    appPath: join(import.meta.dir, '..', '..', '..'),
    resourcesPath: '',
  })
  expect(existsSync(join(fontsDir, 'YoungSerif.ttf'))).toBe(true)
})

test('subtitleLookOptions sets Young Serif from the folder, over ASS styles, outlined with no box', () => {
  expect(subtitleLookOptions({ fontsDir: '/app/fonts' })).toEqual([
    { name: 'sub-fonts-dir', value: '/app/fonts' },
    { name: 'sub-font', value: 'Young Serif' },
    { name: 'sub-ass-override', value: 'force' },
    { name: 'sub-border-style', value: 'outline-and-shadow' },
    { name: 'sub-outline-color', value: '#000000' },
    { name: 'sub-outline-size', value: 2 },
    { name: 'sub-shadow-offset', value: 0 },
  ])
})

test("subtitleStyleOptions maps an account's size and colour to mpv's scale and colour", () => {
  expect(subtitleStyleOptions({ size: 'large', colour: 'cyan' })).toEqual([
    { name: 'sub-scale', value: 1.3 },
    { name: 'sub-color', value: '#6fe8ff' },
  ])
})
