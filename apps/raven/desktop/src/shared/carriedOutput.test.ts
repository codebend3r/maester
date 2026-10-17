import { expect, test } from 'bun:test'
import { DEFAULT_OUTPUT_SETTINGS, type OutputSettings } from '@raven/core'
import { carriedFormats, carriesPassthrough } from '@/shared/carriedOutput'

const passthroughOf = (formats: OutputSettings['passthrough']): OutputSettings => ({
  ...DEFAULT_OUTPUT_SETTINGS,
  profile: 'passthrough',
  passthrough: formats,
})

test('carriedFormats keeps only AC3 and DTS, once each, in a fixed order', () => {
  expect(carriedFormats(passthroughOf(['truehd', 'dts', 'eac3', 'ac3', 'dts']))).toEqual([
    'ac3',
    'dts',
  ])
})

test('passthrough carries when at least one carried format is chosen', () => {
  expect(carriesPassthrough(passthroughOf(['ac3']))).toBe(true)
  expect(carriesPassthrough(passthroughOf(['truehd', 'dts']))).toBe(true)
})

test('passthrough with no carried format plays as PCM', () => {
  expect(carriesPassthrough(passthroughOf([]))).toBe(false)
  expect(carriesPassthrough(passthroughOf(['truehd', 'eac3', 'dts-hd']))).toBe(false)
})

test('the other profiles never carry', () => {
  expect(carriesPassthrough({ ...DEFAULT_OUTPUT_SETTINGS, profile: 'pcm' })).toBe(false)
  expect(carriesPassthrough({ ...DEFAULT_OUTPUT_SETTINGS, profile: 'headphones' })).toBe(false)
})
