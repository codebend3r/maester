import { basename } from 'node:path'

export const IMPORT_KINDS = { bound: 'bound', lookup: 'lookup' } as const

export type Import =
  | { kind: typeof IMPORT_KINDS.bound; symbol: string; library: string }
  | { kind: typeof IMPORT_KINDS.lookup; symbol: string }

// `nm -um` prints every undefined symbol with the library it binds to, or marks it
// "dynamically looked up" when the link was told to leave it unresolved.
const importLine =
  /^\(undefined\) (?:weak )?external (?<symbol>.+) \((?:from (?<library>[^()]+)|dynamically looked up)\)$/

export const parseImports = ({ listing }: { listing: string }): Import[] =>
  listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const groups = importLine.exec(line)?.groups ?? {}
      const { symbol, library } = groups
      if (symbol === undefined) throw new Error(`Unrecognized nm import line: ${line}`)
      return library === undefined
        ? { kind: IMPORT_KINDS.lookup, symbol }
        : { kind: IMPORT_KINDS.bound, symbol, library }
    })

/** Names from `nm -jU`, one per line; Swift and Objective-C names can hold spaces. */
export const parseDefinitions = ({ listing }: { listing: string }) =>
  new Set(listing.split('\n').filter((line) => line !== ''))

/** The short name nm prints in "(from ...)": the leaf of the install name up to its first dot. */
export const libraryName = ({ installName }: { installName: string }) =>
  basename(installName).split('.')[0] ?? installName

type Policy = {
  /** Symbol prefixes the host process provides at load time. */
  lookups: readonly string[]
  /** Symbols the file must define. */
  defines: readonly string[]
}

// libplacebo's shader compiler entry points: pl_glslang_init calls the first and
// pl_glslang_compile the second. Both were null in the libmpv whose window surface crashed.
const glslangEntryPoints = ['__ZN7glslang17InitializeProcessEv', '__Z19GetDefaultResourcesv']

const symbolPolicies = {
  'lib/libMoltenVK.dylib': { lookups: [], defines: [] },
  'lib/libmpv.2.dylib': { lookups: [], defines: glslangEntryPoints },
  // An N-API addon links with `-undefined dynamic_lookup`; Node or Electron supplies N-API,
  // and libuv for the handle that finishes exit cleanup on the loop thread.
  'raven_mpv.node': { lookups: ['_napi_', '_node_api_', '_uv_'], defines: [] },
} as const satisfies Record<string, Policy>

export type AuditedFile = keyof typeof symbolPolicies

const isGlslang = (symbol: string) =>
  symbol.includes('glslang') || symbol.includes('GetDefaultResources')

export const symbolProblems = ({
  file,
  imports,
  definitions,
  dependencies,
}: {
  file: AuditedFile
  imports: Import[]
  definitions: ReadonlySet<string>
  dependencies: string[]
}) => {
  const policy: Policy = symbolPolicies[file]
  const loaded = new Set(dependencies.map((installName) => libraryName({ installName })))
  const lookups = imports
    .filter((entry) => entry.kind === IMPORT_KINDS.lookup)
    .map((entry) => entry.symbol)
    .filter((symbol) => !policy.lookups.some((prefix) => symbol.startsWith(prefix)))
  const glslang = lookups.filter(isGlslang)
  const undefinedEntryPoints = policy.defines.filter((symbol) => !definitions.has(symbol))
  const strays = imports.flatMap((entry) =>
    entry.kind === IMPORT_KINDS.bound && !loaded.has(entry.library)
      ? [`${file} binds ${entry.symbol} to ${entry.library}, which it does not load`]
      : [],
  )
  return [
    ...(glslang.length > 0
      ? [
          `${file} leaves glslang unresolved, so the window surface would crash in pl_glslang_init: ${glslang.join(', ')}`,
        ]
      : []),
    ...(undefinedEntryPoints.length > 0
      ? [`${file} does not define glslang: ${undefinedEntryPoints.join(', ')}`]
      : []),
    ...(lookups.length > 0
      ? [`${file} looks up symbols that nothing it loads provides: ${lookups.join(', ')}`]
      : []),
    ...strays,
  ]
}
