import { useQueryClient } from '@tanstack/react-query'
import type { MediaItem } from '@raven/core'
import { useEffect, useRef } from 'react'
import { afterMatchingPass } from '@/lib/invalidate'

/** How often a listing reads again while something in it is still on its way. */
export const POLL_MS = 3000

export const anyPending = (items: readonly MediaItem[]): boolean =>
  items.some((item) => item.match === 'pending')

/**
 * Nothing else reads the library again after a matching pass, so once
 * `files` go from some pending to none, its count of files not matched is
 * refetched. Every listing that polls through a pass calls it: All, and the
 * Not matched tab.
 */
export const useMatchingPassDone = ({
  libraryId,
  files,
}: {
  libraryId: number
  files: readonly MediaItem[]
}): void => {
  const queryClient = useQueryClient()
  const isMatching = anyPending(files)
  const wasMatching = useRef(false)
  useEffect(() => {
    if (wasMatching.current && !isMatching) void afterMatchingPass({ queryClient, libraryId })
    wasMatching.current = isMatching
  }, [isMatching, libraryId, queryClient])
}
