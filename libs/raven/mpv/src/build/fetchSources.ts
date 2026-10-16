import { resolve } from 'node:path'
import { fetchNodeHeaderSources } from '@/build/nodeHeaders'
import { digest, sources, work, write } from '@/build/context'

/** Digests were measured from the immutable official GitHub source archives, not vendor binaries. */
export const fetchSources = async () => {
  const locked = await sources()
  await locked.reduce(async (previous, source) => {
    await previous
    const path = resolve(work, 'archives', `${source.name}.tar.gz`)
    const cached = Bun.file(path)
    if (await cached.exists()) {
      if (digest(await cached.bytes()) !== source.sha256)
        throw new Error(`Cached source digest mismatch: ${source.name}`)
      return
    }
    const response = await fetch(source.url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Source download failed: ${source.name} (${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (digest(bytes) !== source.sha256) throw new Error(`Source digest mismatch: ${source.name}`)
    await write({ path, content: bytes })
  }, Promise.resolve())
  return locked
}

if (import.meta.main) {
  await fetchSources()
  await fetchNodeHeaderSources()
}
