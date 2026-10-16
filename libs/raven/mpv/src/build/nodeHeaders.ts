import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { digest, resources, run, work, write } from '@/build/context'

// Header digest matches Node's official v24.19.0/SHASUMS256.txt.
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
} as const

const checkedDownload = async ({
  path,
  url,
  sha256,
}: {
  path: string
  url: string
  sha256: string
}) => {
  const file = Bun.file(path)
  if (await file.exists()) {
    if (digest(await file.bytes()) !== sha256)
      throw new Error('Cached Node source checksum mismatch')
    return
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Node source download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (digest(bytes) !== sha256) throw new Error('Node source checksum mismatch')
  await write({ path, content: bytes })
}

export const fetchNodeHeaderSources = async () => {
  const archive = resolve(work, 'archives/node-headers.tar.gz')
  const license = resolve(work, 'archives/node-LICENSE')
  await checkedDownload({ path: archive, ...nodeHeaders.archive })
  await checkedDownload({ path: license, ...nodeHeaders.license })
  return { archive, license }
}

export const fetchNodeHeaders = async () => {
  const { archive, license } = await fetchNodeHeaderSources()
  const directory = resolve(work, 'node-headers')
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  await run({ args: ['tar', '-xzf', archive, '--strip-components=1', '-C', directory] })
  await mkdir(resolve(work, 'source-bundle/archives'), { recursive: true })
  await cp(archive, resolve(work, 'source-bundle/archives/node-headers.tar.gz'))
  await cp(license, resolve(work, 'source-bundle/archives/node-LICENSE'))
  await mkdir(resolve(resources, 'provenance/licenses/node'), { recursive: true })
  await cp(license, resolve(resources, 'provenance/licenses/node/LICENSE'))
  await write({
    path: resolve(resources, 'provenance/node-headers.json'),
    content: JSON.stringify(nodeHeaders, null, 2) + '\n',
  })
  return directory
}
