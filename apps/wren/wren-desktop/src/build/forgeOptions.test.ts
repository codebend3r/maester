import { describe, expect, it } from 'bun:test'
import { SIGNING_ENV, adHocArgs, isPackagedPath, signingFrom } from '@/build/forgeOptions'

const IDENTITY = 'Developer ID Application: Example (TEAM123456)'

describe('signingFrom', () => {
  it('signs ad hoc with no identity, even with a notary profile', () => {
    expect(signingFrom({})).toEqual({})
    expect(signingFrom({ [SIGNING_ENV.notarizeProfile]: 'notary' })).toEqual({})
  })

  it('signs with the identity, and notarizes when a profile is named too', () => {
    expect(signingFrom({ [SIGNING_ENV.identity]: IDENTITY })).toEqual({
      osxSign: { identity: IDENTITY },
    })
    expect(
      signingFrom({ [SIGNING_ENV.identity]: IDENTITY, [SIGNING_ENV.notarizeProfile]: 'notary' }),
    ).toEqual({ osxSign: { identity: IDENTITY }, osxNotarize: { keychainProfile: 'notary' } })
  })
})

describe('isPackagedPath', () => {
  it('packs the manifest and the bundled main, and none of the sources or node_modules', () => {
    expect(['', '/package.json', '/dist', '/dist/main/main.js'].every(isPackagedPath)).toBe(true)
    expect(['/src/main/main.ts', '/node_modules/electron', '/resources'].some(isPackagedPath)).toBe(
      false,
    )
  })
})

describe('adHocArgs', () => {
  it('seals the whole app ad hoc', () => {
    expect(adHocArgs({ app: '/out/Wren.app' })).toEqual([
      '--force',
      '--deep',
      '--sign',
      '-',
      '/out/Wren.app',
    ])
  })
})
