import { describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { Glob } from 'bun'
import { WREN_ROUTES, WREN_WEB_ONLY_ROUTES } from '@/routes'

/** The phone and tablet apps' expo-router tree, whose every file but a layout is a page. */
const APP_DIR = fileURLToPath(new URL('../../music/app', import.meta.url))

const ROUTE_FILES = new Glob('**/*.tsx')

/** A layout frames the pages beside it and is no page itself. */
const LAYOUT = '_layout'

/** The file expo-router serves at its folder's own path. */
const INDEX = 'index'

/** A group, `(tabs)`, sorts files without showing in the path. */
const isGroup = (segment: string): boolean => /^\(.+\)$/.test(segment)

/** A param, `[id]` in a file's name, is `:id` in a web route. */
const webSegmentOf = (segment: string): string => segment.replace(/^\[(.+)\]$/, ':$1')

/** The path a route file is served at, in the shape the web's routes are written in. */
const pathOf = (file: string): string => {
  const segments = file
    .replace(/\.tsx$/, '')
    .split('/')
    .filter((segment) => !isGroup(segment) && segment !== INDEX)
    .map(webSegmentOf)
  return `/${segments.join('/')}`
}

const appPaths = async (): Promise<string[]> => {
  const files = await Array.fromAsync(ROUTE_FILES.scan({ cwd: APP_DIR }))
  return files
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => !file.split('/').some((segment) => segment.startsWith(LAYOUT)))
    .map(pathOf)
    .toSorted()
}

describe('Wren on the web and Wren on the phone', () => {
  it('reads the app tree as paths, groups and layouts left out', () => {
    expect(pathOf('(tabs)/index.tsx')).toBe('/')
    expect(pathOf('(tabs)/library.tsx')).toBe('/library')
    expect(pathOf('album/[id].tsx')).toBe('/album/:id')
    expect(pathOf('collection/[kind].tsx')).toBe('/collection/:kind')
  })

  it('have the same pages, so one added to either app and not the other fails here', async () => {
    const native = await appPaths()
    expect(native.length).toBeGreaterThan(0)
    expect(Object.values<string>(WREN_ROUTES).toSorted()).toEqual(native)
  })

  it('keeps the web-only pages out of the apps, and the apps out of them', async () => {
    const native = await appPaths()
    const webOnly = Object.values<string>(WREN_WEB_ONLY_ROUTES)
    expect(webOnly.filter((path) => native.includes(path))).toEqual([])
    expect(webOnly.filter((path) => Object.values<string>(WREN_ROUTES).includes(path))).toEqual([])
  })
})
