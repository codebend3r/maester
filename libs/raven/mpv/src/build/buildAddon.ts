import { resolve } from 'node:path'
import { auditNative } from '@/build/auditNative'
import { compileAddon } from '@/build/compileAddon'
import { refreshSourceBundle } from '@/build/sourceBundle'
import { requireMacArm, resources, run } from '@/build/context'
import { ARCHITECTURES } from '@/target'

const buildAddon = async () => {
  requireMacArm()
  if (!(await Bun.file(resolve(resources, 'lib/libmpv.2.dylib')).exists()))
    throw new Error('Run fetch:libmpv first. Host libraries are never used.')
  await compileAddon({ arch: ARCHITECTURES.arm64, defines: [], generator: null })
  await run({ args: ['codesign', '--force', '--sign', '-', resolve(resources, 'raven_mpv.node')] })
  await refreshSourceBundle()
  await auditNative()
}

await buildAddon()
