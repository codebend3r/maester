import { useQuery, useQueryClient } from '@tanstack/react-query'
import { METADATA_SERVICE_STATES, type MediaItem, type MetadataHealth } from '@raven/core'
import { useEffect, useRef } from 'react'
import { afterAiLookups } from '@/lib/invalidate'
import { metadataHealthQuery } from '@/lib/queries'
import { POLL_MS, anyPending } from '@/pages/LibraryPage/useMatchingPassDone'

/**
 * Whether the server, by its last health read, still has lookups to run or
 * files to match, after which it looks up what it left unmatched. Never
 * while the AI lookup is off.
 */
const isBusy = (health: MetadataHealth | undefined): boolean =>
  health != null &&
  health.ai !== METADATA_SERVICE_STATES.off &&
  (health.aiPending > 0 || (health.tmdb === METADATA_SERVICE_STATES.ok && health.pending > 0))

/**
 * The AI lookups run after a matching pass, once nothing is pending, so the
 * Not matched tab calls this to see what they find. While the server is
 * busy, or `files` wait to be matched, health is read again every few
 * seconds. Once it goes from busy to idle, the listing and the library's
 * count are read again: a lookup over between two reads is caught too.
 */
export const useAiLookupsDone = ({
  libraryId,
  files,
}: {
  libraryId: number
  files: readonly MediaItem[]
}): void => {
  const queryClient = useQueryClient()
  const health = useQuery({
    ...metadataHealthQuery,
    // A read cached before the lookups began would never start the poll.
    refetchOnMount: 'always',
    refetchInterval: (current) => {
      const last = current.state.data
      if (last == null || last.ai === METADATA_SERVICE_STATES.off) return false
      return isBusy(last) || (last.tmdb === METADATA_SERVICE_STATES.ok && anyPending(files))
        ? POLL_MS
        : false
    },
  })
  const isWorking = isBusy(health.data)
  const wasWorking = useRef(false)
  useEffect(() => {
    if (wasWorking.current && !isWorking) void afterAiLookups({ queryClient, libraryId })
    wasWorking.current = isWorking
  }, [isWorking, libraryId, queryClient])
}
