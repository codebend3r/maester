import { resolve } from 'node:path'
import { auditWindows } from '@/build/auditWindows'
import { compileAddon } from '@/build/compileAddon'
import { isWindows, windowsResources, work, write } from '@/build/context'
import { readPe } from '@/build/pe'
import { WINDOWS_FILES } from '@/build/windowsLock'
import { ARCHITECTURES } from '@/target'

// The DLL came from MinGW, so MSVC gets an import library made from the DLL's own export
// list; CMake runs lib.exe over it.
// Ninja with MSVC's compiler on PATH (a Developer Command Prompt, or msvc-dev-cmd in CI):
// cmake-js's own Visual Studio lookup overflows its buffer on a runner's full install, and
// CMake's Visual Studio generator cannot see the install from the job either.
const NINJA = 'Ninja'

const buildWindowsAddon = async () => {
  if (!isWindows()) throw new Error('The Windows addon builds on Windows only')
  const dll = Bun.file(resolve(windowsResources, WINDOWS_FILES.libmpv))
  if (!(await dll.exists())) throw new Error('Run fetch:libmpv:windows first.')
  const { exports } = readPe({ bytes: await dll.bytes() })
  // Outside the build folder, which cmake-js empties when it retries a build from clean.
  const definition = resolve(work, 'libmpv.def')
  await write({
    path: definition,
    content: `LIBRARY libmpv-2.dll\nEXPORTS\n${exports.join('\n')}\n`,
  })
  await compileAddon({
    arch: ARCHITECTURES.x64,
    defines: [`RAVEN_LIBMPV_DEF=${definition}`],
    generator: NINJA,
  })
  await auditWindows()
}

await buildWindowsAddon()
