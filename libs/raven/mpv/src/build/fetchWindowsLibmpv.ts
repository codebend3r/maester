import { cp, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { auditWindows } from '@/build/auditWindows'
import {
  BUILD_TARGETS,
  checkedDownload,
  output,
  PLATFORMS,
  run,
  windowsResources,
  work,
  write,
} from '@/build/context'
import { prebuilt, WINDOWS_FILES } from '@/build/windowsLock'

/**
 * Places the pinned Windows libmpv under `resources/win32-x64`: the DLL, its headers and
 * the provenance the audit checks. Nothing is built; the lock names the one archive this
 * may come from. bsdtar reads 7z archives, on macOS and as Windows' own `tar`.
 */

// Windows' tar is bsdtar in System32. A Git for Windows bash puts GNU tar first on PATH,
// and that one reads `D:\...` as a host name.
const ENV_NAMES = { systemRoot: 'SystemRoot' } as const
const TAR =
  process.platform === PLATFORMS.win32
    ? join(process.env[ENV_NAMES.systemRoot] ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'

export const fetchWindowsLibmpv = async () => {
  const locked = await prebuilt()
  const archive = resolve(work, `archives/libmpv-${BUILD_TARGETS.win32X64}.7z`)
  await checkedDownload({
    path: archive,
    url: locked.url,
    sha256: locked.sha256,
    what: locked.name,
  })
  const extracted = resolve(work, `libmpv-${BUILD_TARGETS.win32X64}`)
  await rm(extracted, { recursive: true, force: true })
  await mkdir(extracted, { recursive: true })
  await run({ args: [TAR, '-xf', archive, '-C', extracted] })
  await rm(windowsResources, { recursive: true, force: true })
  await mkdir(windowsResources, { recursive: true })
  await cp(
    resolve(extracted, WINDOWS_FILES.libmpv),
    resolve(windowsResources, WINDOWS_FILES.libmpv),
  )
  await cp(
    resolve(extracted, WINDOWS_FILES.headers),
    resolve(windowsResources, WINDOWS_FILES.headers),
    { recursive: true },
  )
  await write({
    path: resolve(windowsResources, 'provenance/build.json'),
    content:
      JSON.stringify(
        {
          platform: BUILD_TARGETS.win32X64,
          revision: await output({ args: ['git', 'rev-parse', 'HEAD'] }),
          prebuilt: locked,
        },
        null,
        2,
      ) + '\n',
  })
  await auditWindows()
}

if (import.meta.main) await fetchWindowsLibmpv()
