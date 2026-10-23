import { basename, dirname, isAbsolute, join, sep } from 'node:path'
import { WEB_DIST } from '@/build/forgeOptions'
import { MPV_MACH_O } from '@/build/stageMpv'

export const PACKAGED_APP = join('out', 'Raven-darwin-arm64', 'Raven.app')
export const MPV_IN_APP = join('Contents', 'Resources', 'mpv', 'darwin-arm64')
/** The web app's build, which the web host serves the window. */
export const WEB_IN_APP = join('Contents', 'Resources', basename(WEB_DIST))
const WEB_PAGE = 'index.html'

const ALLOWED_LINK_PREFIXES = [
  '/System/Library/',
  '/usr/lib/',
  '@rpath/',
  '@loader_path/',
  '@executable_path/',
] as const
const LOADER_PATH = '@loader_path'
const EXECUTABLE_PATH = '@executable_path'
const ALLOWED_RPATH_PREFIXES = [LOADER_PATH, EXECUTABLE_PATH] as const
const RPATH_LINK = '@rpath/'
const EXECUTABLE_DIR = join('Contents', 'MacOS')
const COMPATIBILITY = / \(compatibility version [^)]*\)$/
const RPATH_PATH = /^\s*path (.+) \(offset \d+\)$/m
const MAIN_COMMAND = /^\s*cmd LC_MAIN$/m
const PARENT_DIR = '..'

/** What the audit reads of each Mach-O file: the tool and the flag that asks for it. */
export const MACH_O_READS = {
  links: { command: 'otool', flag: '-L' },
  loadCommands: { command: 'otool', flag: '-l' },
  archs: { command: 'lipo', flag: '-archs' },
} as const

type MachORead = (typeof MACH_O_READS)[keyof typeof MACH_O_READS]

/** The paths after the header line, without "(compatibility ...)". */
export const parseLinks = (otoolL: string): string[] =>
  otoolL
    .split('\n')
    .filter((line) => /^\s/.test(line) && line.trim().length > 0)
    .map((line) => line.trim().replace(COMPATIBILITY, ''))

/** Each LC_RPATH `path`. */
export const parseRpaths = (otoolLoad: string): string[] =>
  otoolLoad
    .split(/^Load command \d+$/m)
    .filter((command) => /^\s*cmd LC_RPATH$/m.test(command))
    .flatMap((command) => {
      const path = RPATH_PATH.exec(command)?.[1] ?? null
      return path === null ? [] : [path]
    })

/** Only an executable has an entry point; a dylib, the addon included, has none. */
export const parseIsExecutable = (otoolLoad: string): boolean => MAIN_COMMAND.test(otoolLoad)

export const parseArchs = (lipoArchs: string): string[] =>
  lipoArchs.split(/\s+/).filter((arch) => arch.length > 0)

/** A Mach-O file of the app, with `relative` and `dir` relative to the app's folder. */
export type AuditedFile = {
  relative: string
  dir: string
  links: string[]
  rpaths: string[]
  archs: string[]
  isExecutable: boolean
}

// `@executable_path` is the folder of the process's executable: an executable's own, and for a
// library the app's, since the engine is loaded by the app itself.
const executableDirOf = (file: AuditedFile): string =>
  file.isExecutable ? file.dir : EXECUTABLE_DIR

const isUnder = ({ path, prefix }: { path: string; prefix: string }): boolean =>
  path === prefix || path.startsWith(`${prefix}/`)

/** A loader or executable relative path, resolved against the app's folder; null for any other. */
const resolveRelative = ({ path, file }: { path: string; file: AuditedFile }): string | null => {
  if (isUnder({ path, prefix: LOADER_PATH })) return join(file.dir, path.slice(LOADER_PATH.length))
  if (isUnder({ path, prefix: EXECUTABLE_PATH })) {
    return join(executableDirOf(file), path.slice(EXECUTABLE_PATH.length))
  }
  return null
}

const isOutsideApp = (relative: string): boolean =>
  relative === PARENT_DIR || relative.startsWith(`${PARENT_DIR}${sep}`) || isAbsolute(relative)

const climbsOut = ({ path, file }: { path: string; file: AuditedFile }): boolean => {
  const resolved = resolveRelative({ path, file })
  return resolved !== null && isOutsideApp(resolved)
}

const isInEngine = (relative: string): boolean => relative.startsWith(`${MPV_IN_APP}${sep}`)

// Only the engine's links are resolved here. Electron's resolve through its framework layout,
// as Forge ships it, and the packaged smoke proves they load.
const engineProblems = ({
  file,
  exists,
}: {
  file: AuditedFile
  exists: (path: string) => boolean
}): string[] => {
  const searched = file.rpaths.flatMap((rpath) => {
    const dir = resolveRelative({ path: rpath, file })
    return dir === null || isOutsideApp(dir) ? [] : [dir]
  })
  const isThere = (relative: string) => !isOutsideApp(relative) && exists(relative)
  const unfound = file.links
    .filter((link) => link.startsWith(RPATH_LINK))
    .map((link) => link.slice(RPATH_LINK.length))
    .filter((name) => name !== basename(file.relative))
    .filter((name) => !searched.some((dir) => isThere(join(dir, name))))
    .map((name) => `${file.relative} cannot find ${name}`)
  const missing = file.links
    .filter((link) => {
      const resolved = resolveRelative({ path: link, file })
      return resolved !== null && !isOutsideApp(resolved) && !exists(resolved)
    })
    .map((link) => `${file.relative} cannot find ${link}`)
  return [...unfound, ...missing]
}

export const fileProblems = ({
  file,
  exists,
}: {
  file: AuditedFile
  exists: (path: string) => boolean
}): string[] => {
  const outside = file.links
    .filter(
      (link) =>
        !ALLOWED_LINK_PREFIXES.some((prefix) => link.startsWith(prefix)) ||
        climbsOut({ path: link, file }),
    )
    .map((link) => `${file.relative} links ${link} from outside the app`)
  const searches = file.rpaths
    .filter((rpath) => !ALLOWED_RPATH_PREFIXES.some((prefix) => rpath.startsWith(prefix)))
    .map((rpath) => `${file.relative} searches ${rpath}`)
  const escapes = file.rpaths
    .filter((rpath) => climbsOut({ path: rpath, file }))
    .map((rpath) => `${file.relative} searches ${rpath}, outside the app`)
  const archs = file.archs.includes('arm64') ? [] : [`${file.relative} is not arm64`]
  const engine = isInEngine(file.relative) ? engineProblems({ file, exists }) : []
  return [...outside, ...searches, ...escapes, ...archs, ...engine]
}

export const bundleProblems = ({
  files,
  exists,
  plistVersion,
  packageVersion,
}: {
  files: readonly AuditedFile[]
  exists: (relative: string) => boolean
  plistVersion: string
  packageVersion: string
}): string[] => {
  const missing = [...MPV_MACH_O.map((name) => join(MPV_IN_APP, name)), join(WEB_IN_APP, WEB_PAGE)]
    .filter((relative) => !exists(relative))
    .map((relative) => `${relative} is missing from the app`)
  const version =
    plistVersion === packageVersion
      ? []
      : [`Info.plist says ${plistVersion}, package.json says ${packageVersion}`]
  return [...missing, ...version, ...files.flatMap((file) => fileProblems({ file, exists }))]
}

/** Runs a command and answers its standard output; rejects when it fails. */
export type ToolRun = (command: { command: string; args: string[] }) => Promise<string>

/** What a failed command said: its standard error when it wrote one, else its message. */
const failureText = (error: unknown): string => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.trim().length > 0
  ) {
    return error.stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}

type ToolAnswer = { ok: true; output: string } | { ok: false; problem: string }

const ask = async ({
  run,
  read: { command, flag },
  path,
  relative,
}: {
  run: ToolRun
  read: MachORead
  path: string
  relative: string
}): Promise<ToolAnswer> => {
  try {
    return { ok: true, output: await run({ command, args: [flag, path] }) }
  } catch (error) {
    const tool = `${command} ${flag}`
    return { ok: false, problem: `${relative} could not be read by ${tool}: ${failureText(error)}` }
  }
}

/** codesign answers on stderr and fails with a status, so a failure is the problem it names. */
export const signatureProblems = async ({
  run,
  args,
  name,
}: {
  run: ToolRun
  args: string[]
  name: string
}): Promise<string[]> => {
  try {
    await run({ command: 'codesign', args })
    return []
  } catch (error) {
    return [`${name} is not signed: ${failureText(error)}`]
  }
}

/**
 * One Mach-O file of the app, `relative` to its folder. `otoolPath` is where otool reads it,
 * which may be a link to `path`. A file a tool cannot read is a problem that names it, and
 * nothing more of it is audited.
 */
export const auditMachO = async ({
  relative,
  path,
  otoolPath,
  run,
}: {
  relative: string
  path: string
  otoolPath: string
  run: ToolRun
}): Promise<{ file: AuditedFile | null; problems: string[] }> => {
  const [links, load, archs, signature] = await Promise.all([
    ask({ run, read: MACH_O_READS.links, path: otoolPath, relative }),
    ask({ run, read: MACH_O_READS.loadCommands, path: otoolPath, relative }),
    ask({ run, read: MACH_O_READS.archs, path, relative }),
    signatureProblems({ run, args: ['--verify', '--strict', path], name: relative }),
  ])
  if (!links.ok || !load.ok || !archs.ok) {
    const unread = [links, load, archs].flatMap((answer) => (answer.ok ? [] : [answer.problem]))
    return { file: null, problems: [...unread, ...signature] }
  }
  return {
    file: {
      relative,
      dir: dirname(relative),
      links: parseLinks(links.output),
      rpaths: parseRpaths(load.output),
      archs: parseArchs(archs.output),
      isExecutable: parseIsExecutable(load.output),
    },
    problems: signature,
  }
}
