import { describe, expect, test } from 'bun:test'
import { NATIVE_TARGETS, nativeTargetOf } from '@/target'

describe('nativeTargetOf', () => {
  test('names the two builds raven ships', () => {
    expect(nativeTargetOf({ platform: 'darwin', arch: 'arm64' })).toBe(NATIVE_TARGETS.darwinArm64)
    expect(nativeTargetOf({ platform: 'win32', arch: 'x64' })).toBe(NATIVE_TARGETS.win32X64)
  })

  test('answers null where there is no build', () => {
    expect(nativeTargetOf({ platform: 'darwin', arch: 'x64' })).toBeNull()
    expect(nativeTargetOf({ platform: 'win32', arch: 'arm64' })).toBeNull()
    expect(nativeTargetOf({ platform: 'linux', arch: 'x64' })).toBeNull()
  })
})
