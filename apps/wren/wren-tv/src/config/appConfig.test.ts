import { describe, expect, it } from 'bun:test'

import { join } from 'node:path'

import wrenTvConfig, { WREN_TV_ID, WREN_TV_IMAGES } from '#app-config'

const PACKAGE_ROOT = join(import.meta.dir, '..', '..')

const CONFIG_TV = '@react-native-tvos/config-tv'

const configOf = () =>
  wrenTvConfig({
    projectRoot: import.meta.dir,
    staticConfigPath: null,
    packageJsonPath: null,
    config: {},
  })

/** Every path a nested object of pictures names. */
const pathsOf = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object' || value === null) return []
  return Object.values(value).flatMap(pathsOf)
}

/** The options a config plugin was handed, or null where it is not in the list. */
const optionsOf = (name: string): unknown => {
  const entry = (configOf().plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === name,
  )
  return Array.isArray(entry) ? entry[1] : null
}

describe("Wren on TV's Expo config", () => {
  it('names the TV app by its own id on both platforms, beside raven and the phone', () => {
    const config = configOf()
    expect(config.ios?.bundleIdentifier).toBe(WREN_TV_ID)
    expect(config.android?.package).toBe(WREN_TV_ID)
    expect(config.name).toBe('Wren')
  })

  it("is a TV build whatever EXPO_TV says, wearing Wren's banner and layered icon", () => {
    expect(optionsOf(CONFIG_TV)).toEqual({
      isTV: true,
      androidTVBanner: WREN_TV_IMAGES.banner,
      appleTVImages: WREN_TV_IMAGES.apple,
    })
  })

  it('names launcher pictures that exist', async () => {
    const paths = pathsOf(WREN_TV_IMAGES)
    const found = await Promise.all(
      paths.map((path) => Bun.file(join(PACKAGE_ROOT, path)).exists()),
    )
    expect(found).toEqual(paths.map(() => true))
  })
})
