import { describe, expect, it } from 'bun:test'
import { DEFAULT_OUTPUT_SETTINGS, type PassthroughFormat } from '@raven/core'
import {
  CONFIG_FILE,
  EMPTY_CONFIG,
  isDesktopConfig,
  pickOutput,
  setOutput,
} from '@/main/desktopConfig'

describe('isDesktopConfig', () => {
  it('accepts the empty config', () => {
    expect(isDesktopConfig(EMPTY_CONFIG)).toBe(true)
  })

  it('rejects another version', () => {
    expect(isDesktopConfig({ ...EMPTY_CONFIG, version: 2 })).toBe(false)
  })

  it('rejects a config without output', () => {
    expect(isDesktopConfig({ version: 1 })).toBe(false)
  })
})

describe('CONFIG_FILE', () => {
  it('names the file in the user data directory', () => {
    expect(CONFIG_FILE).toBe('desktop-config.json')
  })
})

describe('setOutput', () => {
  it('returns a new config and leaves its input untouched', () => {
    const before = structuredClone(EMPTY_CONFIG)
    const output = { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough' as const }
    const next = setOutput({ config: EMPTY_CONFIG, output })
    expect(next).not.toBe(EMPTY_CONFIG)
    expect(next.output).toEqual(output)
    expect(EMPTY_CONFIG).toEqual(before)
  })
})

describe('pickOutput', () => {
  it('rebuilds the four known fields, deduplicated and in format order', () => {
    const passthrough: PassthroughFormat[] = ['dts', 'ac3', 'dts']
    const dirty = { ...DEFAULT_OUTPUT_SETTINGS, passthrough, extra: 'x' }
    const picked = pickOutput(dirty)
    expect(picked).toEqual({
      profile: 'pcm',
      device: 'auto',
      passthrough: ['ac3', 'dts'],
      spatial: false,
    })
    expect(Object.keys(picked).length).toBe(4)
  })
})
