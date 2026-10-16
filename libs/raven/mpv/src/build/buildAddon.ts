import { resolve } from 'node:path'
import { fetchNodeHeaders, nodeHeaders } from '@/build/nodeHeaders'
import { refreshSourceBundle } from '@/build/sourceBundle'
import { auditNative } from '@/build/auditNative'
import { project, requireMacArm, resources, run, work } from '@/build/context'

requireMacArm()
if (!(await Bun.file(resolve(resources, 'lib/libmpv.2.dylib')).exists()))
  throw new Error('Run fetch:libmpv first. Host libraries are never used.')
const headerDirectory = await fetchNodeHeaders()
await run({
  args: [
    'cmake-js',
    'compile',
    '--directory',
    resolve(project, 'native'),
    '--out',
    resolve(work, 'addon'),
    '--arch',
    'arm64',
    '--runtime',
    'node',
    '--runtime-version',
    nodeHeaders.version,
  ],
  env: { npm_config_nodedir: headerDirectory },
})
await run({ args: ['codesign', '--force', '--sign', '-', resolve(resources, 'raven_mpv.node')] })
await refreshSourceBundle()
await auditNative()
