import type { ApiClient } from '@raven/core'
import { type ProgressSink, afterWatching } from '@raven/ui/headless'
import type { QueryClient } from '@tanstack/react-query'

type ProgressSinkForProps = {
  api: ApiClient
  mediaId: number
  libraryId: number
  queryClient: QueryClient
}

/**
 * Where the viewer's progress goes, as the web's watch page sends it: the play once frames
 * flow, each spot saved, and, once the player goes, the item's page, Home and Continue
 * watching read again after the last save has landed. Every call is the allowlisted client's,
 * and a failed one costs only that spot.
 */
export const progressSinkFor = ({
  api,
  mediaId,
  libraryId,
  queryClient,
}: ProgressSinkForProps): ProgressSink => {
  let lastSave: Promise<unknown> = Promise.resolve()
  return {
    started: () => {
      api.recordPlay(mediaId).catch(() => undefined)
    },
    save: (report) => {
      lastSave = api.saveProgress({ id: mediaId, ...report }).catch(() => undefined)
    },
    left: () => {
      lastSave.then(() => afterWatching({ queryClient, libraryId })).catch(() => undefined)
    },
  }
}
