import { describe, expect, it } from 'bun:test'

import wrenConfig from '#app-config'

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
})
