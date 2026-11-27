import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_PLATFORMS } from '@raven/core'
import { ignoredSpecsFor, PLATFORM_SPECS } from '@/e2e/platformSpecs'

describe('ignoredSpecsFor', () => {
  test('leaves the Windows-only specs out on macOS', () => {
    expect(ignoredSpecsFor({ platform: DESKTOP_PLATFORMS.mac })).toEqual([
      '**/windowsChrome.e2e.ts',
    ])
  })

  test('leaves the macOS-only specs out on Windows', () => {
    expect(ignoredSpecsFor({ platform: DESKTOP_PLATFORMS.windows })).toEqual(['**/hardened.e2e.ts'])
  })
})

describe('PLATFORM_SPECS', () => {
  test('names only specs that exist, so a renamed one cannot run everywhere unnoticed', () => {
    const missing = Object.values(PLATFORM_SPECS)
      .flat()
      .filter((spec) => !existsSync(join(import.meta.dirname, spec)))
    expect(missing).toEqual([])
  })

  test('gives no spec to both systems', () => {
    const specs = Object.values(PLATFORM_SPECS).flat()
    expect(new Set(specs).size).toBe(specs.length)
  })
})
