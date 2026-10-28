import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  checkedDownload,
  isWindows,
  resources,
  run,
  TAR,
  windowsResources,
  work,
  write,
} from '@/build/context'

// The header and import library digests match Node's official v24.19.0/SHASUMS256.txt.
// The license digest was measured from the corresponding official tagged source.
export const nodeHeaders = {
  version: '24.19.0',
  archive: {
    url: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-headers.tar.gz',
    sha256: '54f14a297d47ea0794fe272363703d9dc419c96ac68f20d890f98b63754a3e4c',
  },
  license: {
    url: 'https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE',
    sha256: '148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5',
  },
  // What a Windows addon links against; cmake-js looks for it at x64/node.lib.
  lib: {
    url: 'https://nodejs.org/dist/v24.19.0/win-x64/node.lib',
    sha256: '63ec831bbf164d1b23197d6fac1944dfb146534e332889ca0755d250e8dedff9',
  },
} as const

export const fetchNodeHeaderSources = async () => {
  const archive = resolve(work, 'archives/node-headers.tar.gz')
  const license = resolve(work, 'archives/node-LICENSE')
  await checkedDownload({ path: archive, ...nodeHeaders.archive, what: 'Node headers' })
  await checkedDownload({ path: license, ...nodeHeaders.license, what: 'Node license' })
  return { archive, license }
}

export const fetchNodeHeaders = async () => {
  const { archive, license } = await fetchNodeHeaderSources()
  const target = isWindows() ? windowsResources : resources
  const directory = resolve(work, 'node-headers')
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  await run({ args: [TAR, '-xzf', archive, '--strip-components=1', '-C', directory] })
  if (isWindows()) {
    const lib = resolve(work, 'archives/node.lib')
    await checkedDownload({ path: lib, ...nodeHeaders.lib, what: 'Node import library' })
    await mkdir(resolve(directory, 'x64'), { recursive: true })
    await cp(lib, resolve(directory, 'x64/node.lib'))
  }
  await mkdir(resolve(work, 'source-bundle/archives'), { recursive: true })
  await cp(archive, resolve(work, 'source-bundle/archives/node-headers.tar.gz'))
  await cp(license, resolve(work, 'source-bundle/archives/node-LICENSE'))
  await mkdir(resolve(target, 'provenance/licenses/node'), { recursive: true })
  await cp(license, resolve(target, 'provenance/licenses/node/LICENSE'))
  await write({
    path: resolve(target, 'provenance/node-headers.json'),
    content: JSON.stringify(nodeHeaders, null, 2) + '\n',
  })
  return directory
}
