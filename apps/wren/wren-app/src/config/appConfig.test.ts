import { describe, expect, it } from 'bun:test'

import { join } from 'node:path'

import wrenConfig, { WREN_ICONS } from '#app-config'

const PACKAGE_ROOT = join(import.meta.dir, '..', '..')

const WREN_ID = 'app.netlify.wren'

const configOf = () =>
  wrenConfig({
    projectRoot: import.meta.dir,
    staticConfigPath: null,
    packageJsonPath: null,
    config: {},
  })

describe("Wren's Expo config", () => {
  it('names Wren by one id on both platforms', () => {
    const config = configOf()
    expect(config.ios?.bundleIdentifier).toBe(WREN_ID)
    expect(config.android?.package).toBe(WREN_ID)
  })

  it('opens its own links', () => {
    expect(configOf().scheme).toBe('wren')
  })

  it('wears its own icon on every platform', () => {
    const config = configOf()
    expect(config.icon).toBe(WREN_ICONS.app)
    expect(config.android?.adaptiveIcon?.foregroundImage).toBe(WREN_ICONS.adaptive)
    expect(config.android?.adaptiveIcon?.monochromeImage).toBe(WREN_ICONS.monochrome)
  })

  it('names icon files that exist', async () => {
    const found = await Promise.all(
      Object.values(WREN_ICONS).map((path) => Bun.file(join(PACKAGE_ROOT, path)).exists()),
    )
    expect(found).toEqual(Object.values(WREN_ICONS).map(() => true))
  })
})
