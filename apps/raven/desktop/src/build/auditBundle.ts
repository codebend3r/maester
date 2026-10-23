import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import {
  auditMachO,
  bundleProblems,
  PACKAGED_APP,
  signatureProblems,
  type ToolRun,
} from '@/build/bundleAudit'
import { versionOf } from '@/build/dmgMaker'
import { listSignables, SIGNABLE_KINDS } from '@/build/machO'

const execFileAsync = promisify(execFile)

const run: ToolRun = async ({ command, args }) => {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/**
 * otool reads `name(member)` as a member of the archive `name`, so a path ending in `)`, as
 * "Raven Helper (Renderer)" does, is read through a link with a plain name. The files
 * are audited one at a time, so one link serves them all.
 */
const otoolPathFor = async ({ path, scratch }: { path: string; scratch: string }) => {
  if (!path.endsWith(')')) return path
  const link = join(scratch, 'macho')
  await rm(link, { force: true })
  await symlink(path, link)
  return link
}

type Audited = Awaited<ReturnType<typeof auditMachO>>

const auditFile = async ({
  app,
  path,
  scratch,
}: {
  app: string
  path: string
  scratch: string
}): Promise<Audited> =>
  auditMachO({
    relative: relative(app, path),
    path,
    otoolPath: await otoolPathFor({ path, scratch }),
    run,
  })

const auditFiles = async ({ app, paths }: { app: string; paths: readonly string[] }) => {
  const scratch = await mkdtemp(join(tmpdir(), 'raven-audit-'))
  try {
    return await paths.reduce<Promise<Audited[]>>(
      async (previous, path) => [...(await previous), await auditFile({ app, path, scratch })],
      Promise.resolve([]),
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const audit = async ({ project }: { project: string }): Promise<number> => {
  const app = join(project, PACKAGED_APP)
  if (!existsSync(app)) {
    console.error('Run bunx nx run @raven/desktop:make first.')
    return 1
  }
  const paths = (await listSignables({ app }))
    .filter(({ kind }) => kind === SIGNABLE_KINDS.machO)
    .map(({ path }) => path)
  const audited = await auditFiles({ app, paths })
  const plistVersion = (
    await run({
      command: 'plutil',
      args: ['-extract', 'CFBundleShortVersionString', 'raw', join(app, 'Contents', 'Info.plist')],
    })
  ).trim()
  const packageVersion = versionOf(
    JSON.parse(await readFile(join(project, 'package.json'), 'utf8')),
  )
  const appSignature = await signatureProblems({
    run,
    args: ['--verify', '--deep', '--strict', '--verbose=2', app],
    name: PACKAGED_APP,
  })
  const problems = [
    ...bundleProblems({
      files: audited.flatMap(({ file }) => (file === null ? [] : [file])),
      exists: (relativePath) => existsSync(join(app, relativePath)),
      plistVersion,
      packageVersion,
    }),
    ...audited.flatMap((file) => file.problems),
    ...appSignature,
  ]
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(problem))
    return 1
  }
  process.stdout.write(
    `Raven bundle: ${paths.length} Mach-O files, all inside the app and signed.\n`,
  )
  return 0
}

if (import.meta.main) {
  process.exitCode = await audit({ project: join(import.meta.dirname, '..', '..') })
}
