import { useQueryClient } from '@tanstack/react-query'
import { type Library, isRefreshingRatings } from '@raven/core'
import { useEffect, useRef } from 'react'
import { afterLibraryEvent } from '@/lib/invalidate'

/**
 * A Refresh changes scores and the rating sorts without any server event,
 * so once a library goes from running or waiting to idle, its listings are
 * read again.
 */
export const useRatingsRefreshDone = (library: Library): void => {
  const queryClient = useQueryClient()
  const isRefreshing = isRefreshingRatings(library)
  const wasRefreshing = useRef(isRefreshing)
  const libraryId = library.id
  useEffect(() => {
    if (wasRefreshing.current && !isRefreshing) void afterLibraryEvent({ queryClient, libraryId })
    wasRefreshing.current = isRefreshing
  }, [isRefreshing, libraryId, queryClient])
}
