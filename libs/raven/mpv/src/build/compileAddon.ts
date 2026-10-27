import { resolve } from 'node:path'
import { fetchNodeHeaders, nodeHeaders } from '@/build/nodeHeaders'
import { project, run, work } from '@/build/context'
import type { ARCHITECTURES } from '@/target'

type CompileAddonProps = {
  arch: (typeof ARCHITECTURES)[keyof typeof ARCHITECTURES]
  defines: readonly string[]
  /** A CMake generator to name outright; null lets cmake-js find one. */
  generator: string | null
}

/** Compiles the addon with cmake-js against the pinned Node headers. */
export const compileAddon = async ({ arch, defines, generator }: CompileAddonProps) => {
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
      arch,
      '--runtime',
      'node',
      '--runtime-version',
      nodeHeaders.version,
      ...defines.map((define) => `--CD${define}`),
      ...(generator === null ? [] : ['--generator', generator]),
    ],
    env: { npm_config_nodedir: headerDirectory },
  })
}
