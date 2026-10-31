import type { BrowseAnswer, BrowseNode } from '@raven/audio/contract'
import {
  type BrowseApi,
  type CarBrowse,
  browseChildrenOf,
  parseBrowseId,
  queueSourceOf,
  tracksForBrowse,
} from '@raven/native/headless'
import { useAudioQueue } from '@raven/ui/headless'

import { useDownloads } from '@/downloads/downloadStore'
import { downloadedLibraryOf } from '@/downloads/downloadViews'

/** A saved cover's address, which native reads from disk with no headers. */
const FILE_SCHEME = 'file://'

type CarBrowseForProps = {
  api: BrowseApi
  serverId: string
  /** The `file://` address a download's path is at now. */
  uriOf: (path: string) => string
  /** The headers a request to `uri` on the server carries: its cookies and the account's token. */
  headersFor: (uri: string) => Promise<Record<string, string>>
  answer: (answer: BrowseAnswer) => Promise<void>
}

/**
 * Wren's answers to CarPlay and Android Auto, over the browse tree: the server's library while
 * it answers, else, when it fails or is out of reach, what is downloaded, so the car lists and
 * plays the downloads offline. A chosen node fills the shared queue.
 */
export const carBrowseFor = ({
  api,
  serverId,
  uriOf,
  headersFor,
  answer,
}: CarBrowseForProps): CarBrowse => {
  const downloads = () => downloadedLibraryOf({ ...useDownloads.getState(), serverId, uriOf })

  // Every http cover in an answer is the server's own picture, so one set of headers serves them all.
  const artworkHeadersOf = async (nodes: BrowseNode[]): Promise<Record<string, string>> => {
    const [served] = nodes.flatMap(({ artworkUri }) =>
      artworkUri === null || artworkUri.startsWith(FILE_SCHEME) ? [] : [artworkUri],
    )
    return served === undefined ? {} : headersFor(served).catch(() => ({}))
  }

  const childrenOf = (parentId: string) =>
    browseChildrenOf({ api, downloads: downloads(), parentId }).catch(() =>
      browseChildrenOf({ api: null, downloads: downloads(), parentId }),
    )

  const tracksOf = (id: string) =>
    tracksForBrowse({ api, downloads: downloads(), id }).catch(() =>
      tracksForBrowse({ api: null, downloads: downloads(), id }),
    )

  return {
    browse: ({ requestId, parentId }) => {
      childrenOf(parentId)
        .then(async (nodes) =>
          answer({ requestId, nodes, artworkHeaders: await artworkHeadersOf(nodes) }),
        )
        .catch(() => console.warn('Wren could not answer the car.'))
    },
    play: ({ id }) => {
      tracksOf(id)
        .then((tracks) => {
          const target = parseBrowseId(id)
          if (tracks.length === 0 || target === null) return
          useAudioQueue.getState().playTracks({ tracks, source: queueSourceOf(target) })
        })
        .catch(() => console.warn('Wren could not play what the car chose.'))
    },
  }
}
