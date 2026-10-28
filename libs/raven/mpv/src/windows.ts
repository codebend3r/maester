import { isString, object, type Infer } from '@raven/core'

/**
 * What a Windows build of raven may load and where its libmpv comes from. The native build
 * audits the resources with it, and the desktop audits the packaged app with it.
 */

const isPrebuiltShape = object({
  name: isString,
  repository: isString,
  release: isString,
  mpvCommit: isString,
  url: isString,
  sha256: isString,
  libmpvSha256: isString,
  license: isString,
})

export type Prebuilt = Infer<typeof isPrebuiltShape>

const SHA256 = /^[a-f0-9]{64}$/

/**
 * The Windows libmpv is a prebuilt from mpv-winbuild-cmake, pinned to one release
 * archive by digest, and the DLL inside it by its own digest. The URL is derived from
 * the repository, the release and mpv's commit, so the lock cannot point elsewhere.
 */
export const isPrebuilt = (value: unknown): value is Prebuilt =>
  isPrebuiltShape(value) &&
  /^[a-zA-Z0-9_-]+$/.test(value.name) &&
  /^\d{8}$/.test(value.release) &&
  /^[a-f0-9]{10}$/.test(value.mpvCommit) &&
  SHA256.test(value.sha256) &&
  SHA256.test(value.libmpvSha256) &&
  /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(value.repository) &&
  value.url ===
    `${value.repository}/releases/download/${value.release}/mpv-dev-x86_64-${value.release}-git-${value.mpvCommit}.7z`

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
export const ADDON_DLLS = ['libmpv-2.dll', 'node.exe'] as const

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
