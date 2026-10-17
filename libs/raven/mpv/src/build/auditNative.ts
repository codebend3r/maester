import { basename, resolve } from 'node:path'
import { isRecord, isString, listOf, object } from '@raven/core'
import { nodeHeaders } from '@/build/nodeHeaders'
import { parseDefinitions, parseImports, symbolProblems, type AuditedFile } from '@/build/symbols'
import {
  digest,
  output,
  project,
  requireMacArm,
  resources,
  run,
  sources,
  work,
  write,
} from '@/build/context'

/** Every undefined symbol must bind to a library the file loads; nm is in Xcode and its CLI tools. */
export const inspectSymbols = async ({
  file,
  path,
  dependencies,
}: {
  file: AuditedFile
  path: string
  dependencies: string[]
}) =>
  symbolProblems({
    file,
    imports: parseImports({ listing: await output({ args: ['nm', '-um', path] }) }),
    definitions: parseDefinitions({ listing: await output({ args: ['nm', '-jU', path] }) }),
    dependencies,
  })

export const auditNative = async ({ requireAddon = true }: { requireAddon?: boolean } = {}) => {
  requireMacArm()
  const files: AuditedFile[] = [
    'lib/libMoltenVK.dylib',
    'lib/libmpv.2.dylib',
    ...(requireAddon ? ['raven_mpv.node' as const] : []),
  ]
  const locked = await sources()
  await locked.reduce(async (previous, source) => {
    await previous
    const file = Bun.file(resolve(work, 'source-bundle/archives', `${source.name}.tar.gz`))
    if (!(await file.exists()) || digest(await file.bytes()) !== source.sha256)
      throw new Error(`Missing matching source archive: ${source.name}`)
  }, Promise.resolve())
  const provenance: unknown = JSON.parse(
    await Bun.file(resolve(resources, 'provenance/sources.json')).text(),
  )
  if (JSON.stringify(provenance) !== JSON.stringify(locked))
    throw new Error('Runtime source provenance does not match lock')
  const build: unknown = JSON.parse(
    await Bun.file(resolve(resources, 'provenance/build.json')).text(),
  )
  const isBuild = object({
    sourceRevision: isString,
    repositorySourceSha256: isString,
    sources: isString,
    patches: listOf(object({ name: isString, sha256: isString })),
  })
  if (
    !isBuild(build) ||
    build.sourceRevision !== (await output({ args: ['git', 'rev-parse', 'HEAD'] })) ||
    build.repositorySourceSha256 !==
      digest(await Bun.file(resolve(work, 'source-bundle/raven-repository.tar.gz')).bytes()) ||
    build.sources !== digest(JSON.stringify(locked))
  )
    throw new Error('Native source receipt mismatch')
  const patches = await Promise.all(
    ['0001-player-add-moltenvk-context.patch', '0002-moltenvk-resize.patch'].map(async (name) => ({
      name,
      sha256: digest(await Bun.file(resolve(project, 'native/patches', name)).bytes()),
    })),
  )
  if (JSON.stringify(build.patches) !== JSON.stringify(patches))
    throw new Error('Native patch provenance mismatch')
  await locked.reduce(async (previous, source) => {
    await previous
    const notices = Array.from(
      new Bun.Glob('**/*').scanSync({
        cwd: resolve(resources, 'provenance/licenses', source.name),
        onlyFiles: true,
      }),
    )
    if (notices.length === 0) throw new Error(`Missing license notices: ${source.name}`)
  }, Promise.resolve())
  if (requireAddon) {
    if (
      digest(
        await Bun.file(resolve(work, 'source-bundle/archives/node-headers.tar.gz')).bytes(),
      ) !== nodeHeaders.archive.sha256 ||
      digest(await Bun.file(resolve(work, 'source-bundle/archives/node-LICENSE')).bytes()) !==
        nodeHeaders.license.sha256 ||
      digest(await Bun.file(resolve(resources, 'provenance/licenses/node/LICENSE')).bytes()) !==
        nodeHeaders.license.sha256
    )
      throw new Error('Node header source/notice provenance mismatch')
    const dependency: unknown = JSON.parse(await Bun.file(resolve(project, 'package.json')).text())
    const sourcePackage: unknown = JSON.parse(
      await Bun.file(resolve(work, 'source-bundle/node-addon-api/package.json')).text(),
    )
    const headerProvenance: unknown = JSON.parse(
      await Bun.file(resolve(resources, 'provenance/node-headers.json')).text(),
    )
    if (JSON.stringify(headerProvenance) !== JSON.stringify(nodeHeaders))
      throw new Error('Node header source receipt mismatch')
    if (
      !isRecord(dependency) ||
      !isRecord(dependency.dependencies) ||
      !isRecord(sourcePackage) ||
      !isString(sourcePackage.version) ||
      !isString(dependency.dependencies['node-addon-api']) ||
      sourcePackage.version !== dependency.dependencies['node-addon-api'] ||
      !(await Bun.file(
        resolve(resources, 'provenance/licenses/node-addon-api/LICENSE.md'),
      ).exists())
    )
      throw new Error('node-addon-api source/notice provenance mismatch')
  }
  const inspected = await Promise.all(
    files.map(async (file) => {
      const path = resolve(resources, file)
      if ((await output({ args: ['lipo', '-archs', path] })) !== 'arm64')
        throw new Error(`Not arm64-only: ${file}`)
      const id = (await output({ args: ['otool', '-D', path] })).split('\n')[1]
      if (id !== `@rpath/${basename(file)}`) throw new Error(`Nonrelocatable install id: ${file}`)
      const links = await output({ args: ['otool', '-L', path] })
      const dependencies = links
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(' ')[0])
      await Promise.all(
        dependencies.map(async (dependency) => {
          if (dependency === `@rpath/${basename(file)}`) return
          if (dependency.startsWith('/System/Library/') || dependency.startsWith('/usr/lib/'))
            return
          if (
            dependency !== `@rpath/${basename(dependency)}` ||
            !(await Bun.file(resolve(resources, 'lib', basename(dependency))).exists())
          )
            throw new Error(`Unbundled dependency in ${file}: ${dependency}`)
        }),
      )
      const commands = await output({ args: ['otool', '-l', path] })
      const rpaths = [...commands.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (\S+) /g)].map(
        (match) => match[1],
      )
      if (!rpaths.every((rpath) => rpath === '@loader_path' || rpath === '@loader_path/lib'))
        throw new Error(`Host rpath in ${file}`)
      const relativeDependencies = dependencies.filter(
        (dependency) =>
          dependency.startsWith('@rpath/') && dependency !== `@rpath/${basename(file)}`,
      )
      if (
        relativeDependencies.length > 0 &&
        !rpaths.includes(file.endsWith('.node') ? '@loader_path/lib' : '@loader_path')
      )
        throw new Error(`Missing loader-relative search path in ${file}`)
      const symbolIssues = await inspectSymbols({ file, path, dependencies })
      if (symbolIssues.length > 0) throw new Error(symbolIssues.join('\n'))
      await run({ args: ['codesign', '--verify', '--strict', path] })
      return { file, sha256: digest(await Bun.file(path).bytes()), dependencies, rpaths }
    }),
  )
  await write({
    path: resolve(resources, 'provenance/artifacts.json'),
    content:
      JSON.stringify(
        {
          files: inspected,
          sourceLockSha256: digest(
            await Bun.file(resolve(project, 'native/sources.lock.json')).bytes(),
          ),
        },
        null,
        2,
      ) + '\n',
  })
}

if (import.meta.main) await auditNative()
