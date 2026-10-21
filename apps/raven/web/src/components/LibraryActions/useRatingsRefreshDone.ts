import { useQueryClient } from '@tanstack/react-query'
import type { Library } from '@raven/core'
import { useEffect, useRef } from 'react'
import { afterLibraryEvent } from '@raven/ui/headless'

/**
 * A Refresh changes scores and the rating sorts without any server event, so
 * once a library moves out of running, to waiting for the daily limit as much
 * as to idle, or from waiting to idle, its listings are read again.
 */
export const useRatingsRefreshDone = (library: Library): void => {
  const queryClient = useQueryClient()
  const { state } = library.ratingsRefresh
  const before = useRef(state)
  const libraryId = library.id
  useEffect(() => {
    const wasRunning = before.current === 'running' && state !== 'running'
    const wasWaiting = before.current === 'waiting' && state === 'idle'
    before.current = state
    if (wasRunning || wasWaiting) void afterLibraryEvent({ queryClient, libraryId })
  }, [state, libraryId, queryClient])
}
