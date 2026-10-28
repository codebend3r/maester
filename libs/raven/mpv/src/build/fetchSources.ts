import { resolve } from 'node:path'
import { fetchNodeHeaderSources } from '@/build/nodeHeaders'
import { checkedDownload, inSequence, sources, work } from '@/build/context'

/** Digests were measured from the immutable official GitHub source archives, not vendor binaries. */
export const fetchSources = async () => {
  const locked = await sources()
  await inSequence({
    items: locked,
    each: (source) =>
      checkedDownload({
        path: resolve(work, 'archives', `${source.name}.tar.gz`),
        url: source.url,
        sha256: source.sha256,
        what: source.name,
      }),
  })
  return locked
}

if (import.meta.main) {
  await fetchSources()
  await fetchNodeHeaderSources()
}
