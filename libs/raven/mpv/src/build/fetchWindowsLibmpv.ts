import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { auditWindows } from '@/build/auditWindows'
import { checkedDownload, output, TAR, run, windowsResources, work, write } from '@/build/context'
import { NATIVE_TARGETS } from '@/target'
import { prebuilt, WINDOWS_FILES } from '@/build/windowsLock'

/**
 * Places the pinned Windows libmpv under `resources/win32-x64`: the DLL, its headers and
 * the provenance the audit checks. Nothing is built; the lock names the one archive this
 * may come from. bsdtar reads 7z archives, on macOS and as Windows' own `tar`.
 */

export const fetchWindowsLibmpv = async () => {
  const locked = await prebuilt()
  const archive = resolve(work, `archives/libmpv-${NATIVE_TARGETS.win32X64}.7z`)
  await checkedDownload({
    path: archive,
    url: locked.url,
    sha256: locked.sha256,
    what: locked.name,
  })
  const extracted = resolve(work, `libmpv-${NATIVE_TARGETS.win32X64}`)
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
          platform: NATIVE_TARGETS.win32X64,
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
