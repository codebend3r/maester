import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  BUILD_TARGETS,
  digest,
  inSequence,
  output,
  project,
  resources,
  run,
  work,
  write,
} from '@/build/context'
import { isRecord } from '@raven/core'

/** Refresh head-specific application sources even when pinned native dependencies came from CI cache. */
export const refreshSourceBundle = async () => {
  const bundle = resolve(work, 'source-bundle')
  await mkdir(bundle, { recursive: true })
  await rm(resolve(bundle, 'raven-mpv'), { recursive: true, force: true })
  await inSequence({
    items: ['native', 'src', 'test'],
    each: (name) =>
      cp(resolve(project, name), resolve(bundle, 'raven-mpv', name), { recursive: true }),
  })
  await inSequence({
    items: ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md'],
    each: (name) => cp(resolve(project, name), resolve(bundle, 'raven-mpv', name)),
  })
  await cp(resolve(project, '../../../bun.lock'), resolve(bundle, 'bun.lock'))
  const archive = resolve(bundle, 'raven-repository.tar.gz')
  await run({ args: ['git', 'archive', '--format=tar.gz', `--output=${archive}`, 'HEAD'] })
  await cp(resolve(project, 'node_modules/node-addon-api'), resolve(bundle, 'node-addon-api'), {
    recursive: true,
    dereference: true,
  })
  await mkdir(resolve(resources, 'provenance/licenses/node-addon-api'), { recursive: true })
  await cp(
    resolve(project, 'node_modules/node-addon-api/LICENSE.md'),
    resolve(resources, 'provenance/licenses/node-addon-api/LICENSE.md'),
  )
  const path = resolve(resources, 'provenance/build.json')
  const previous: unknown = JSON.parse(await Bun.file(path).text())
  if (!isRecord(previous) || previous.platform !== BUILD_TARGETS.darwinArm64)
    throw new Error('Invalid native build provenance')
  await write({
    path,
    content:
      JSON.stringify(
        {
          ...previous,
          sourceRevision: await output({ args: ['git', 'rev-parse', 'HEAD'] }),
          repositorySourceSha256: digest(await Bun.file(archive).bytes()),
        },
        null,
        2,
      ) + '\n',
  })
}
