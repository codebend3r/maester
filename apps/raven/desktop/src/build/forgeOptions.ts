/**
 * The tested half of forge.config.ts. Forge loads its config with jiti, which does not read
 * tsconfig `paths`, so this file imports nothing from the project.
 */

export const DOCUMENT_UTIS = [
  'public.movie',
  'public.mpeg-4',
  'com.apple.quicktime-movie',
  'public.avi',
  'public.mpeg-2-transport-stream',
  'org.matroska.mkv',
  'org.webmproject.webm',
] as const

export type DocumentUti = (typeof DOCUMENT_UTIS)[number]

// Formats macOS has no UTI of its own for conform to `public.movie` where it knows them.
const UTI_BY_EXTENSION = {
  mp4: 'public.mpeg-4',
  m4v: 'public.mpeg-4',
  mov: 'com.apple.quicktime-movie',
  avi: 'public.avi',
  ts: 'public.mpeg-2-transport-stream',
  m2ts: 'public.mpeg-2-transport-stream',
  mts: 'public.mpeg-2-transport-stream',
  mkv: 'org.matroska.mkv',
  webm: 'org.webmproject.webm',
  '3gp': 'public.movie',
  flv: 'public.movie',
  mpeg: 'public.movie',
  mpg: 'public.movie',
  ogv: 'public.movie',
  wmv: 'public.movie',
} as const satisfies Record<string, DocumentUti>

const isMappedExtension = (extension: string): extension is keyof typeof UTI_BY_EXTENSION =>
  Object.hasOwn(UTI_BY_EXTENSION, extension)

export const utiFor = (extension: string): DocumentUti | null => {
  const lower = extension.toLowerCase()
  return isMappedExtension(lower) ? UTI_BY_EXTENSION[lower] : null
}

type ImportedType = {
  UTTypeIdentifier: string
  UTTypeDescription: string
  UTTypeConformsTo: string[]
  UTTypeTagSpecification: { 'public.filename-extension': string[]; 'public.mime-type': string[] }
}

// macOS ships no declaration for these two, so the app imports them for LaunchServices.
const IMPORTED_TYPES = [
  {
    uti: 'org.matroska.mkv',
    description: 'Matroska video',
    extension: 'mkv',
    mime: 'video/x-matroska',
  },
  { uti: 'org.webmproject.webm', description: 'WebM video', extension: 'webm', mime: 'video/webm' },
] as const satisfies readonly {
  uti: DocumentUti
  description: string
  extension: string
  mime: string
}[]

type DocumentType = {
  CFBundleTypeName: string
  CFBundleTypeRole: 'Viewer'
  LSHandlerRank: 'Alternate'
  LSItemContentTypes: DocumentUti[]
}

export type DocumentTypes = {
  CFBundleDocumentTypes: DocumentType[]
  UTImportedTypeDeclarations: ImportedType[]
}

/**
 * Info.plist's document types for the extensions, claimed by UTI and never by bare
 * extension, at `Alternate` rank so raven player is offered without taking over a default.
 * Throws when an extension has no UTI, so a new video extension fails until it is placed.
 */
export const documentTypes = (extensions: readonly string[]): DocumentTypes => {
  const unplaced = extensions.filter((extension) => utiFor(extension) === null)
  if (unplaced.length > 0) {
    throw new Error(`No UTI for the video extensions: ${unplaced.join(', ')}`)
  }
  const used = new Set(extensions.map(utiFor))
  return {
    CFBundleDocumentTypes: [
      {
        CFBundleTypeName: 'Video',
        CFBundleTypeRole: 'Viewer',
        LSHandlerRank: 'Alternate',
        LSItemContentTypes: DOCUMENT_UTIS.filter((uti) => used.has(uti)),
      },
    ],
    UTImportedTypeDeclarations: IMPORTED_TYPES.filter(({ uti }) => used.has(uti)).map(
      ({ uti, description, extension, mime }) => ({
        UTTypeIdentifier: uti,
        UTTypeDescription: description,
        UTTypeConformsTo: ['public.movie'],
        UTTypeTagSpecification: {
          'public.filename-extension': [extension],
          'public.mime-type': [mime],
        },
      }),
    ),
  }
}

export const FUSES = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  EnableCookieEncryption: true,
} as const

export type Signing = { osxSign?: { identity: string }; osxNotarize?: { keychainProfile: string } }

/**
 * Developer ID signing and notarization, off until a certificate exists: with no
 * `RAVEN_SIGN_IDENTITY` the app is signed ad hoc, and notarizing needs an identity too.
 */
export const signingFrom = (env: Readonly<Record<string, string | undefined>>): Signing => {
  const identity = env.RAVEN_SIGN_IDENTITY ?? ''
  if (identity === '') return {}
  const keychainProfile = env.RAVEN_NOTARIZE_PROFILE ?? ''
  if (keychainProfile === '') return { osxSign: { identity } }
  return { osxSign: { identity }, osxNotarize: { keychainProfile } }
}

/**
 * What goes in the asar, as the packager names paths: relative to the project, with a
 * leading slash, and '' for the project itself. Main and preload are self-contained bundles,
 * so Bun's symlinked node_modules stays out along with the sources.
 */
export const isPackagedPath = (file: string): boolean =>
  file === '' || file === '/package.json' || file === '/dist' || file.startsWith('/dist/')

/**
 * codesign's arguments to seal the finished bundle ad hoc. The fuses plugin re-signs right
 * after flipping the fuses, but the packager then renames the executables and writes the
 * final Info.plist, which breaks that seal; an app with a broken seal is "damaged" to
 * Gatekeeper once downloaded.
 */
export const adHocSealArgs = ({ app }: { app: string }): string[] => [
  '--sign',
  '-',
  '--force',
  '--deep',
  app,
]
