import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { PE_MACHINES } from '@raven/mpv'
import {
  auditMachO,
  auditPe,
  type AuditedFile,
  type AuditedPe,
  bundleProblems,
  fileProblems,
  isPeFile,
  MACH_O_READS,
  MPV_IN_APP,
  MPV_IN_WINDOWS_APP,
  WEB_IN_APP,
  WINDOWS_EXE,
  windowsBundleProblems,
  parseArchs,
  parseIsExecutable,
  parseLinks,
  parseRpaths,
  type ToolRun,
} from '@/build/bundleAudit'
import { MPV_MACH_O } from '@/build/stageMpv'

const OTOOL_L = [
  `${MPV_IN_APP}/lib/libmpv.2.dylib:`,
  '\t@rpath/libmpv.2.dylib (compatibility version 2.0.0, current version 2.0.0)',
  '\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 2100.43.0)',
  '\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0, current version 5026.5.4)',
  '',
].join('\n')

const OTOOL_LOAD = [
  'Load command 4',
  '          cmd LC_ID_DYLIB',
  '      cmdsize 48',
  '         name @rpath/libmpv.2.dylib (offset 24)',
  'Load command 55',
  '          cmd LC_RPATH',
  '      cmdsize 32',
  '         path @loader_path (offset 12)',
  'Load command 56',
  '          cmd LC_RPATH',
  '      cmdsize 32',
  '         path @loader_path/lib (offset 12)',
  'Load command 57',
  '          cmd LC_FUNCTION_STARTS',
  '      cmdsize 16',
  '',
].join('\n')

const LIB = join(MPV_IN_APP, 'lib')

const auditedFile = (overrides: Partial<AuditedFile>): AuditedFile => ({
  relative: join(LIB, 'libmpv.2.dylib'),
  dir: LIB,
  links: ['@rpath/libmpv.2.dylib'],
  rpaths: ['@loader_path'],
  archs: ['arm64'],
  isExecutable: false,
  ...overrides,
})

describe('parseLinks', () => {
  it('gives the linked paths without the header or the versions', () => {
    expect(parseLinks(OTOOL_L)).toEqual([
      '@rpath/libmpv.2.dylib',
      '/usr/lib/libc++.1.dylib',
      '/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation',
    ])
  })

  it('gives nothing for an empty listing', () => {
    expect(parseLinks('')).toEqual([])
  })
})

describe('parseRpaths', () => {
  it('gives every LC_RPATH path', () => {
    expect(parseRpaths(OTOOL_LOAD)).toEqual(['@loader_path', '@loader_path/lib'])
  })

  it('gives nothing without an LC_RPATH', () => {
    expect(parseRpaths('Load command 4\n          cmd LC_ID_DYLIB\n')).toEqual([])
  })
})

describe('parseIsExecutable', () => {
  it('knows an executable by its LC_MAIN', () => {
    expect(parseIsExecutable('Load command 9\n       cmd LC_MAIN\n   cmdsize 24\n')).toBe(true)
  })

  it('knows a dylib or a bundle by its lack of one', () => {
    expect(parseIsExecutable(OTOOL_LOAD)).toBe(false)
  })
})

describe('parseArchs', () => {
  it('splits the architectures lipo names', () => {
    expect(parseArchs('x86_64 arm64\n')).toEqual(['x86_64', 'arm64'])
  })

  it('gives nothing for empty output', () => {
    expect(parseArchs('\n')).toEqual([])
  })
})

describe('fileProblems', () => {
  const noFiles = () => false

  it('flags links from outside the app', () => {
    const file = auditedFile({
      links: [
        '@rpath/libmpv.2.dylib',
        '/opt/homebrew/lib/libass.9.dylib',
        '/usr/local/lib/x.dylib',
      ],
    })
    expect(fileProblems({ file, exists: noFiles })).toEqual([
      `${file.relative} links /opt/homebrew/lib/libass.9.dylib from outside the app`,
      `${file.relative} links /usr/local/lib/x.dylib from outside the app`,
    ])
  })

  it('flags an absolute rpath', () => {
    const file = auditedFile({ rpaths: ['@loader_path', '/opt/homebrew/lib'] })
    expect(fileProblems({ file, exists: noFiles })).toEqual([
      `${file.relative} searches /opt/homebrew/lib`,
    ])
  })

  it('accepts system links and an @rpath dylib that sits beside it', () => {
    const file = auditedFile({
      links: [
        '@rpath/libmpv.2.dylib',
        '/System/Library/Frameworks/Metal.framework/Versions/A/Metal',
        '/usr/lib/libc++.1.dylib',
        '@rpath/libMoltenVK.dylib',
      ],
    })
    const exists = (path: string) => path === join(LIB, 'libMoltenVK.dylib')
    expect(fileProblems({ file, exists })).toEqual([])
  })

  it('flags an @rpath dylib that no rpath finds', () => {
    const file = auditedFile({ links: ['@rpath/libmpv.2.dylib', '@rpath/libMoltenVK.dylib'] })
    expect(fileProblems({ file, exists: noFiles })).toEqual([
      `${file.relative} cannot find libMoltenVK.dylib`,
    ])
  })

  it('finds an @rpath dylib through a loader-relative folder', () => {
    const file = auditedFile({
      relative: join(MPV_IN_APP, 'raven_mpv.node'),
      dir: MPV_IN_APP,
      links: ['@rpath/raven_mpv.node', '@rpath/libmpv.2.dylib'],
      rpaths: ['@loader_path/lib'],
    })
    const exists = (path: string) => path === join(LIB, 'libmpv.2.dylib')
    expect(fileProblems({ file, exists })).toEqual([])
  })

  it('leaves @rpath links outside the engine to their own rpaths', () => {
    const file = auditedFile({
      relative: 'Contents/MacOS/Raven',
      dir: 'Contents/MacOS',
      links: ['@rpath/Electron Framework.framework/Electron Framework'],
      rpaths: ['@executable_path/../Frameworks'],
    })
    expect(fileProblems({ file, exists: noFiles })).toEqual([])
  })

  it('flags a loader or executable relative link that climbs out of the app', () => {
    const file = auditedFile({
      links: [
        '@rpath/libmpv.2.dylib',
        '@loader_path/../../../../../../opt/homebrew/lib/libass.9.dylib',
        '@executable_path/../../../x.dylib',
      ],
    })
    expect(fileProblems({ file, exists: () => true })).toEqual([
      `${file.relative} links @loader_path/../../../../../../opt/homebrew/lib/libass.9.dylib from outside the app`,
      `${file.relative} links @executable_path/../../../x.dylib from outside the app`,
    ])
  })

  it('flags an rpath that climbs out of the app, and finds nothing through it', () => {
    const file = auditedFile({
      links: ['@rpath/libmpv.2.dylib', '@rpath/libMoltenVK.dylib'],
      rpaths: ['@loader_path/../../../../../..', '@executable_path/../../..'],
    })
    expect(fileProblems({ file, exists: () => true })).toEqual([
      `${file.relative} searches @loader_path/../../../../../.., outside the app`,
      `${file.relative} searches @executable_path/../../.., outside the app`,
      `${file.relative} cannot find libMoltenVK.dylib`,
    ])
  })

  it('never finds an @rpath dylib whose name climbs out of the app', () => {
    const file = auditedFile({ links: ['@rpath/../../../../../../x.dylib'] })
    expect(fileProblems({ file, exists: () => true })).toEqual([
      `${file.relative} cannot find ../../../../../../x.dylib`,
    ])
  })

  it("resolves an executable's own @executable_path against its folder", () => {
    const helper = 'Contents/Frameworks/Raven Helper.app/Contents/MacOS'
    const file = auditedFile({
      relative: `${helper}/Raven Helper`,
      dir: helper,
      links: ['@rpath/Electron Framework.framework/Electron Framework'],
      rpaths: ['@executable_path/../../..'],
      isExecutable: true,
    })
    expect(fileProblems({ file, exists: noFiles })).toEqual([])
  })

  it("resolves a library's @executable_path against the app's executable folder", () => {
    const file = auditedFile({
      relative: 'Contents/Frameworks/Squirrel.framework/Versions/A/Squirrel',
      dir: 'Contents/Frameworks/Squirrel.framework/Versions/A',
      links: [],
      rpaths: ['@executable_path/../Frameworks'],
    })
    expect(fileProblems({ file, exists: noFiles })).toEqual([])
  })

  it("flags an engine file's loader or executable relative link that is not there", () => {
    const file = auditedFile({
      links: [
        '@rpath/libmpv.2.dylib',
        '@loader_path/libMoltenVK.dylib',
        '@loader_path/libass.9.dylib',
        '@executable_path/../Frameworks/x.dylib',
      ],
    })
    const exists = (path: string) => path === join(LIB, 'libMoltenVK.dylib')
    expect(fileProblems({ file, exists })).toEqual([
      `${file.relative} cannot find @loader_path/libass.9.dylib`,
      `${file.relative} cannot find @executable_path/../Frameworks/x.dylib`,
    ])
  })

  it('flags a file that is not arm64', () => {
    const file = auditedFile({ archs: ['x86_64'] })
    expect(fileProblems({ file, exists: noFiles })).toEqual([`${file.relative} is not arm64`])
  })
})

describe('bundleProblems', () => {
  const everyEngineFile = (relative: string) =>
    MPV_MACH_O.some((name) => relative === join(MPV_IN_APP, name)) ||
    relative === join(WEB_IN_APP, 'index.html')

  it('passes a whole bundle', () => {
    expect(
      bundleProblems({
        files: [auditedFile({})],
        exists: everyEngineFile,
        plistVersion: '0.5.4',
        packageVersion: '0.5.4',
      }),
    ).toEqual([])
  })

  it('names a missing libmpv and a version mismatch', () => {
    const libmpv = join(MPV_IN_APP, 'lib', 'libmpv.2.dylib')
    expect(
      bundleProblems({
        files: [],
        exists: (relative) => everyEngineFile(relative) && relative !== libmpv,
        plistVersion: '0.5.3',
        packageVersion: '0.5.4',
      }),
    ).toEqual([
      `${libmpv} is missing from the app`,
      'Info.plist says 0.5.3, package.json says 0.5.4',
    ])
  })

  it('names a missing web app', () => {
    const page = join(WEB_IN_APP, 'index.html')
    expect(page).toBe(join('Contents', 'Resources', 'dist', 'index.html'))
    expect(
      bundleProblems({
        files: [],
        exists: (relative) => everyEngineFile(relative) && relative !== page,
        plistVersion: '0.5.4',
        packageVersion: '0.5.4',
      }),
    ).toEqual([`${page} is missing from the app`])
  })

  it('includes every file problem', () => {
    const file = auditedFile({ archs: ['x86_64'] })
    expect(
      bundleProblems({
        files: [file],
        exists: everyEngineFile,
        plistVersion: '0.5.4',
        packageVersion: '0.5.4',
      }),
    ).toEqual([`${file.relative} is not arm64`])
  })
})

describe('auditMachO', () => {
  const RELATIVE = join(LIB, 'libmpv.2.dylib')
  const PATH = `/o/a.app/${RELATIVE}`

  type KeyOfProps = { command: string; flag: string }

  /** A read as the fake keys it: the tool and its first argument. */
  const keyOf = ({ command, flag }: KeyOfProps) => `${command} ${flag}`

  const answers =
    (failures: Partial<Record<string, unknown>>): ToolRun =>
    async ({ command, args }) => {
      const key = `${command} ${args[0] ?? ''}`
      if (key in failures) throw failures[key]
      if (key === keyOf(MACH_O_READS.links)) return OTOOL_L
      if (key === keyOf(MACH_O_READS.loadCommands)) return OTOOL_LOAD
      if (key === keyOf(MACH_O_READS.archs)) return 'arm64\n'
      return ''
    }

  const stderrError = (stderr: string) => Object.assign(new Error('Command failed'), { stderr })

  it('reads the links, rpaths, archs and signature of a file', async () => {
    expect(
      await auditMachO({ relative: RELATIVE, path: PATH, otoolPath: PATH, run: answers({}) }),
    ).toEqual({
      file: {
        relative: RELATIVE,
        dir: LIB,
        links: parseLinks(OTOOL_L),
        rpaths: ['@loader_path', '@loader_path/lib'],
        archs: ['arm64'],
        isExecutable: false,
      },
      problems: [],
    })
  })

  it('names the file and the tool when otool or lipo fails, and audits nothing more of it', async () => {
    const run = answers({
      [keyOf(MACH_O_READS.links)]: stderrError('otool: truncated or malformed object'),
      [keyOf(MACH_O_READS.archs)]: new Error('spawn lipo ENOENT'),
    })
    expect(await auditMachO({ relative: RELATIVE, path: PATH, otoolPath: PATH, run })).toEqual({
      file: null,
      problems: [
        `${RELATIVE} could not be read by otool -L: otool: truncated or malformed object`,
        `${RELATIVE} could not be read by lipo -archs: spawn lipo ENOENT`,
      ],
    })
  })

  it('says a file is not signed with what codesign said', async () => {
    const run = answers({ 'codesign --verify': stderrError('code object is not signed at all') })
    const audited = await auditMachO({ relative: RELATIVE, path: PATH, otoolPath: PATH, run })
    expect(audited.problems).toEqual([
      `${RELATIVE} is not signed: code object is not signed at all`,
    ])
    expect(audited.file).not.toBeNull()
  })
})

const LOCKED_SHA256 = 'a'.repeat(64)
const ADDON = join(MPV_IN_WINDOWS_APP, 'raven_mpv.node')
const LIBMPV = join(MPV_IN_WINDOWS_APP, 'libmpv-2.dll')
const WINDOWS_PRESENT = [WINDOWS_EXE, ADDON, LIBMPV, join('resources', 'dist', 'index.html')]

const auditedPe = (overrides: Partial<AuditedPe>): AuditedPe => ({
  relative: ADDON,
  machine: PE_MACHINES.x64,
  imports: ['KERNEL32.dll', 'libmpv-2.dll', 'node.exe'],
  sha256: 'b'.repeat(64),
  ...overrides,
})

const WINDOWS_FILES_AS_BUILT = [
  auditedPe({}),
  auditedPe({ relative: LIBMPV, imports: ['KERNEL32.dll', 'vulkan-1.dll'], sha256: LOCKED_SHA256 }),
]

type WindowsProblemsProps = { files: readonly AuditedPe[]; present?: readonly string[] }

const windowsProblems = ({ files, present = WINDOWS_PRESENT }: WindowsProblemsProps) =>
  windowsBundleProblems({
    files,
    exists: (relative) => present.includes(relative),
    libmpvSha256: LOCKED_SHA256,
  })

describe('isPeFile', () => {
  it('takes the addon and DLLs, in any case, and leaves the rest', () => {
    expect(
      ['raven_mpv.node', 'libmpv-2.dll', 'X.DLL', 'build.json', 'mpv'].filter(isPeFile),
    ).toEqual(['raven_mpv.node', 'libmpv-2.dll', 'X.DLL'])
  })
})

describe('windowsBundleProblems', () => {
  it('passes the app as built: the exe, the page, an x64 addon on Windows, libmpv and Node, the locked libmpv', () => {
    expect(windowsProblems({ files: WINDOWS_FILES_AS_BUILT })).toEqual([])
  })

  it('names what is missing from the app', () => {
    expect(windowsProblems({ files: [], present: [] })).toEqual([
      'Raven.exe is missing from the app',
      `${ADDON} is missing from the app`,
      `${LIBMPV} is missing from the app`,
      `${join('resources', 'dist', 'index.html')} is missing from the app`,
    ])
  })

  it('says which addon or DLL is not x64', () => {
    const arm64 = 0xaa64
    expect(
      windowsProblems({
        files: [auditedPe({ machine: arm64 }), ...WINDOWS_FILES_AS_BUILT.slice(1)],
      }),
    ).toEqual([`${ADDON} is not x64`])
  })

  it('names an import the addon has beyond Windows, libmpv and Node', () => {
    expect(
      windowsProblems({
        files: [
          auditedPe({ imports: ['KERNEL32.dll', 'libmpv-2.dll', 'avcodec-62.dll'] }),
          ...WINDOWS_FILES_AS_BUILT.slice(1),
        ],
      }),
    ).toEqual([`${ADDON} imports avcodec-62.dll, which neither Windows nor the app ships`])
  })

  it('refuses a libmpv the lock does not pin', () => {
    const other = 'c'.repeat(64)
    expect(
      windowsProblems({ files: [auditedPe({}), auditedPe({ relative: LIBMPV, sha256: other })] }),
    ).toEqual([
      `${LIBMPV} is not the locked libmpv: sha256 ${other}, the lock says ${LOCKED_SHA256}`,
    ])
  })
})

describe('auditPe', () => {
  it('names a file that does not read as a PE file', () => {
    expect(auditPe({ relative: ADDON, bytes: new Uint8Array(8) })).toEqual({
      file: null,
      problems: [`${ADDON} could not be read: Not a PE file: no DOS header`],
    })
  })
})
