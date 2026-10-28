import { resolve } from 'node:path'
import { isRecord } from '@raven/core'
import { digest, project, windowsResources, write } from '@/build/context'
import { NATIVE_TARGETS } from '@/target'
import { PE_MACHINES, readPe } from '@/build/pe'
import { prebuilt, WINDOWS_FILES } from '@/build/windowsLock'

/**
 * Every DLL the prebuilt may import: Windows' own, the Vulkan loader the graphics driver
 * installs, and the CRT's api sets. mpv's dependencies (ffmpeg, libplacebo, libass and the
 * rest) are linked in statically, so any other import means the DLL is not self-contained.
 */
const SYSTEM_DLLS = [
  'advapi32.dll',
  'avicap32.dll',
  'avrt.dll',
  'bcrypt.dll',
  'bcryptprimitives.dll',
  'crypt32.dll',
  'd2d1.dll',
  'dwmapi.dll',
  'dwrite.dll',
  'gdi32.dll',
  'imm32.dll',
  'iphlpapi.dll',
  'kernel32.dll',
  'normaliz.dll',
  'ntdll.dll',
  'ole32.dll',
  'oleaut32.dll',
  'opengl32.dll',
  'secur32.dll',
  'setupapi.dll',
  'shcore.dll',
  'shell32.dll',
  'shlwapi.dll',
  'user32.dll',
  'uxtheme.dll',
  'version.dll',
  'vulkan-1.dll',
  'winmm.dll',
  'wldap32.dll',
  'ws2_32.dll',
] as const
const API_SET_PREFIX = 'api-ms-win-'
/** What the addon may import beyond Windows' own: libmpv beside it, and Node's exports. */
const ADDON_DLLS = ['libmpv-2.dll', 'node.exe'] as const

/** What the addon calls, so a DLL missing one cannot pass as libmpv. */
export const REQUIRED_EXPORTS = [
  'mpv_client_api_version',
  'mpv_create',
  'mpv_initialize',
  'mpv_set_option',
  'mpv_set_option_string',
  'mpv_command_async',
  'mpv_get_property_async',
  'mpv_observe_property',
  'mpv_wait_event',
  'mpv_terminate_destroy',
  'mpv_render_context_create',
] as const

/** The headers the addon compiles against. */
const REQUIRED_HEADERS = ['client.h', 'render.h'] as const

type ImportProblemsProps = {
  imports: readonly string[]
  /** DLLs of our own the file may import, beside Windows'. */
  allowed?: readonly string[]
}

/** The imports that are neither Windows' own nor allowed. */
export const importProblems = ({ imports, allowed = [] }: ImportProblemsProps): readonly string[] =>
  imports.filter((name) => {
    const lower = name.toLowerCase()
    return (
      !lower.startsWith(API_SET_PREFIX) &&
      !SYSTEM_DLLS.some((dll) => dll === lower) &&
      !allowed.some((dll) => dll === lower)
    )
  })

type ExportProblemsProps = {
  exports: readonly string[]
}

/** The required exports the DLL lacks. */
export const exportProblems = ({ exports }: ExportProblemsProps): readonly string[] =>
  REQUIRED_EXPORTS.filter((name) => !exports.includes(name))

type AuditedFile = {
  file: string
  sha256: string
  imports: readonly string[]
}

/** The addon, when it has been built: x64, and loading only libmpv beside it and Node. */
const auditAddon = async (): Promise<readonly AuditedFile[]> => {
  const file = Bun.file(resolve(windowsResources, WINDOWS_FILES.addon))
  if (!(await file.exists())) return []
  const bytes = await file.bytes()
  const info = readPe({ bytes })
  if (info.machine !== PE_MACHINES.x64) throw new Error('The addon is not x64')
  const problems = importProblems({ imports: info.imports, allowed: ADDON_DLLS })
  if (problems.length > 0) throw new Error(`Unexpected import in the addon: ${problems.join(', ')}`)
  return [{ file: WINDOWS_FILES.addon, sha256: digest(bytes), imports: info.imports }]
}

export const auditWindows = async () => {
  const locked = await prebuilt()
  const build: unknown = JSON.parse(
    await Bun.file(resolve(windowsResources, 'provenance/build.json')).text(),
  )
  if (
    !isRecord(build) ||
    build.platform !== NATIVE_TARGETS.win32X64 ||
    JSON.stringify(build.prebuilt) !== JSON.stringify(locked)
  )
    throw new Error('Windows libmpv provenance does not match lock')
  const path = resolve(windowsResources, WINDOWS_FILES.libmpv)
  const bytes = await Bun.file(path).bytes()
  const sha256 = digest(bytes)
  if (sha256 !== locked.libmpvSha256) throw new Error('Windows libmpv digest mismatch')
  const info = readPe({ bytes })
  if (info.machine !== PE_MACHINES.x64) throw new Error('Windows libmpv is not x64')
  const imports = importProblems({ imports: info.imports })
  if (imports.length > 0) throw new Error(`Unbundled dependency in libmpv: ${imports.join(', ')}`)
  const missing = exportProblems({ exports: info.exports })
  if (missing.length > 0) throw new Error(`libmpv lacks exports: ${missing.join(', ')}`)
  const headers = await Promise.all(
    REQUIRED_HEADERS.map(async (name) => ({
      name,
      isPresent: await Bun.file(resolve(windowsResources, WINDOWS_FILES.headers, name)).exists(),
    })),
  )
  const absent = headers.filter(({ isPresent }) => !isPresent).map(({ name }) => name)
  if (absent.length > 0) throw new Error(`Missing libmpv headers: ${absent.join(', ')}`)
  const addon = await auditAddon()
  await write({
    path: resolve(windowsResources, 'provenance/artifacts.json'),
    content:
      JSON.stringify(
        {
          files: [{ file: WINDOWS_FILES.libmpv, sha256, imports: info.imports }, ...addon],
          windowsLockSha256: digest(
            await Bun.file(resolve(project, 'native/windows.lock.json')).bytes(),
          ),
        },
        null,
        2,
      ) + '\n',
  })
}

if (import.meta.main) await auditWindows()
