import { describe, expect, it } from 'bun:test'
import { VIDEO_EXTENSIONS } from '@raven/core'
import {
  adHocSealArgs,
  DOCUMENT_UTIS,
  type DocumentUti,
  documentTypes,
  FUSES,
  isPackagedPath,
  signingFrom,
  utiFor,
} from '@/build/forgeOptions'

describe('utiFor', () => {
  it('places an extension whatever its case', () => {
    expect(utiFor('MKV')).toBe('org.matroska.mkv')
  })

  const placed: [string, DocumentUti][] = [
    ['mp4', 'public.mpeg-4'],
    ['m4v', 'public.mpeg-4'],
    ['mov', 'com.apple.quicktime-movie'],
    ['avi', 'public.avi'],
    ['ts', 'public.mpeg-2-transport-stream'],
    ['m2ts', 'public.mpeg-2-transport-stream'],
    ['mts', 'public.mpeg-2-transport-stream'],
    ['mkv', 'org.matroska.mkv'],
    ['webm', 'org.webmproject.webm'],
    ['3gp', 'public.movie'],
    ['flv', 'public.movie'],
    ['mpeg', 'public.movie'],
    ['mpg', 'public.movie'],
    ['ogv', 'public.movie'],
    ['wmv', 'public.movie'],
  ]

  it.each(placed)('maps %s to %s', (extension, uti) => {
    expect(utiFor(extension)).toBe(uti)
  })

  it('has nothing for a subtitle', () => {
    expect(utiFor('srt')).toBeNull()
  })
})

describe('documentTypes', () => {
  const types = documentTypes(VIDEO_EXTENSIONS)

  it('declares one viewer document type over every UTI, in order, at Alternate rank', () => {
    expect(types.CFBundleDocumentTypes).toEqual([
      {
        CFBundleTypeName: 'Video',
        CFBundleTypeRole: 'Viewer',
        LSHandlerRank: 'Alternate',
        LSItemContentTypes: [...DOCUMENT_UTIS],
      },
    ])
  })

  it('imports the Matroska and WebM types macOS does not know', () => {
    expect(types.UTImportedTypeDeclarations).toEqual([
      {
        UTTypeIdentifier: 'org.matroska.mkv',
        UTTypeDescription: 'Matroska video',
        UTTypeConformsTo: ['public.movie'],
        UTTypeTagSpecification: {
          'public.filename-extension': ['mkv'],
          'public.mime-type': ['video/x-matroska'],
        },
      },
      {
        UTTypeIdentifier: 'org.webmproject.webm',
        UTTypeDescription: 'WebM video',
        UTTypeConformsTo: ['public.movie'],
        UTTypeTagSpecification: {
          'public.filename-extension': ['webm'],
          'public.mime-type': ['video/webm'],
        },
      },
    ])
  })

  it('never claims a bare extension, so .ts sources stay with the editor', () => {
    expect(JSON.stringify(types.CFBundleDocumentTypes)).not.toContain('"ts"')
  })

  it('names every extension it cannot place', () => {
    expect(() => documentTypes(['mp4', 'xyz', 'abc'])).toThrow(/xyz.*abc/)
  })

  it('lists only the UTIs the extensions use', () => {
    expect(
      documentTypes(['mkv', 'MP4']).CFBundleDocumentTypes[0]?.LSItemContentTypes ?? [],
    ).toEqual(['public.mpeg-4', 'org.matroska.mkv'])
  })
})

describe('FUSES', () => {
  it('turns off Node entry points and keeps the app to its checked asar', () => {
    expect(FUSES).toEqual({
      RunAsNode: false,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      EnableEmbeddedAsarIntegrityValidation: true,
      OnlyLoadAppFromAsar: true,
      EnableCookieEncryption: true,
    })
  })
})

describe('signingFrom', () => {
  it('signs ad hoc when no identity is set', () => {
    expect(signingFrom({})).toEqual({})
    expect(signingFrom({ RAVEN_SIGN_IDENTITY: '' })).toEqual({})
  })

  it('does not notarize without an identity', () => {
    expect(signingFrom({ RAVEN_NOTARIZE_PROFILE: 'raven' })).toEqual({})
  })

  it('signs with the identity alone', () => {
    expect(signingFrom({ RAVEN_SIGN_IDENTITY: 'Developer ID Application: CJ' })).toEqual({
      osxSign: { identity: 'Developer ID Application: CJ' },
    })
  })

  it('signs and notarizes when both are set', () => {
    expect(
      signingFrom({
        RAVEN_SIGN_IDENTITY: 'Developer ID Application: CJ',
        RAVEN_NOTARIZE_PROFILE: 'raven',
      }),
    ).toEqual({
      osxSign: { identity: 'Developer ID Application: CJ' },
      osxNotarize: { keychainProfile: 'raven' },
    })
  })
})

describe('adHocSealArgs', () => {
  it('reseals the whole bundle ad hoc, nested helpers included', () => {
    expect(adHocSealArgs({ app: '/out/raven player.app' })).toEqual([
      '--sign',
      '-',
      '--force',
      '--deep',
      '/out/raven player.app',
    ])
  })
})

describe('isPackagedPath', () => {
  it.each(['', '/package.json', '/dist', '/dist/main/main.js', '/dist/renderer/index.html'])(
    'packages %p',
    (file) => {
      expect(isPackagedPath(file)).toBe(true)
    },
  )

  it.each([
    '/node_modules',
    '/node_modules/react/index.js',
    '/src',
    '/src/main/main.ts',
    '/e2e/harness.ts',
    '/out/make',
    '/forge.config.ts',
    '/distant',
  ])('leaves out %p', (file) => {
    expect(isPackagedPath(file)).toBe(false)
  })
})
