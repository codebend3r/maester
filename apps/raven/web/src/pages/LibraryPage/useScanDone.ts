import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { afterLibraryEvent } from '@raven/ui/headless'
import { handled } from '@/lib/handled'

type UseScanDoneProps = {
  libraryId: number
  isScanning: boolean
}

/**
 * A listing does not read itself again while a scan runs: the server says when
 * a scan's walk changed the library, and a library of tens of thousands of
 * videos read every few seconds kept the page busy for the whole scan. So once
 * the scan ends, what it probed is read in one go.
 */
export const useScanDone = ({ libraryId, isScanning }: UseScanDoneProps): void => {
  const queryClient = useQueryClient()
  const wasScanning = useRef(isScanning)
  useEffect(() => {
    if (wasScanning.current && !isScanning) handled(afterLibraryEvent({ queryClient, libraryId }))
    wasScanning.current = isScanning
  }, [isScanning, libraryId, queryClient])
}
