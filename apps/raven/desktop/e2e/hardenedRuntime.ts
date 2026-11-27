import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { adHocSignArgs, runCommand, signAdHoc } from '@/build/machO'
import { electronExecutable } from '@/e2e/harness'

/**
 * What a Developer ID build of Raven runs under: the hardened runtime with Electron's default
 * entitlement, `allow-jit`, which lets only `MAP_JIT` pages execute. Disabling library
 * validation is this host's alone: ad hoc signatures carry no Team ID, so without it the
 * hardened main refuses Electron's own framework before the app starts. It has no bearing on
 * which pages may execute.
 */
const ENTITLEMENTS = {
  allowJit: 'com.apple.security.cs.allow-jit',
  disableLibraryValidation: 'com.apple.security.cs.disable-library-validation',
} as const

const ENTITLEMENTS_PLIST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0"><dict>',
  ...Object.values(ENTITLEMENTS).map((key) => `<key>${key}</key><true/>`),
  '</dict></plist>',
].join('\n')

export type HardenedElectron = { folder: string; executable: string }

/**
 * A copy of the checkout's Electron signed ad hoc and run under the hardened runtime, so the
 * app it launches meets the kernel's code signing rules the way a signed release does.
 */
export const hardenedElectron = async (): Promise<HardenedElectron> => {
  const executable = electronExecutable()
  // The executable sits at `Electron.app/Contents/MacOS/Electron`.
  const bundle = join(executable, '..', '..', '..')
  const folder = await mkdtemp(join(tmpdir(), 'raven-e2e-hardened-'))
  const app = join(folder, 'Electron.app')
  const entitlements = join(folder, 'entitlements.plist')
  await Promise.all([
    cp(bundle, app, { recursive: true, verbatimSymlinks: true }),
    writeFile(entitlements, ENTITLEMENTS_PLIST),
  ])
  await signAdHoc({ app, run: runCommand })
  await runCommand({
    command: 'codesign',
    args: ['--options', 'runtime', '--entitlements', entitlements, ...adHocSignArgs({ path: app })],
  })
  return { folder, executable: join(app, relative(bundle, executable)) }
}
