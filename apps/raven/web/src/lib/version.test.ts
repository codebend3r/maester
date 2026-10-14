import { describe, expect, it } from 'bun:test'
import { releaseVersion } from '@/lib/version'

const packageVersion = '0.5.3'

describe('releaseVersion', () => {
  it('shows the build CI baked in: the release and its build number', () => {
    expect(releaseVersion({ built: '0.5.3.4', packageVersion })).toBe('0.5.3.4')
    expect(releaseVersion({ built: '0.5.3.12', packageVersion })).toBe('0.5.3.12')
  })

  it("shows package.json's version when no build was baked in", () => {
    expect(releaseVersion({ built: undefined, packageVersion })).toBe('0.5.3')
    expect(releaseVersion({ built: '', packageVersion })).toBe('0.5.3')
    expect(releaseVersion({ built: '0.5.3', packageVersion })).toBe('0.5.3')
  })

  it("shows package.json's version over a build of another version or a malformed one", () => {
    expect(releaseVersion({ built: '0.5.2.4', packageVersion })).toBe('0.5.3')
    expect(releaseVersion({ built: '0.5.30.1', packageVersion })).toBe('0.5.3')
    expect(releaseVersion({ built: '0.5.3.0', packageVersion })).toBe('0.5.3')
    expect(releaseVersion({ built: '0.5.3.x', packageVersion })).toBe('0.5.3')
    expect(releaseVersion({ built: '0.5.3.4.1', packageVersion })).toBe('0.5.3')
  })
})
