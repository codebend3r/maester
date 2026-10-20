import { useMediaOriginProbe } from '@raven/ui'
import { type ReactNode, useLayoutEffect } from 'react'
import { useIsServed } from '@/lib/accessState'
import { api } from '@/lib/api'
import { useOriginProbe } from '@/stores/originProbe'

/**
 * Probes the server's media origins as the app opens and as the network
 * changes, and puts `reprobe` in `useOriginProbe` for whatever plays media
 * beneath it, which draws once it is there. With accounts on it probes once
 * an account is approved, as the server answers no one else.
 */
export const MediaOriginProbe = ({ children }: { children: ReactNode }) => {
  const isEnabled = useIsServed()
  const { reprobe } = useMediaOriginProbe({ api, isEnabled })
  useLayoutEffect(() => {
    useOriginProbe.setState({ reprobe })
    return () => {
      if (useOriginProbe.getState().reprobe === reprobe) useOriginProbe.setState({ reprobe: null })
    }
  }, [reprobe])
  const isProbing = useOriginProbe((state) => state.reprobe !== null)
  return isProbing && children
}

/** Probes the origins again: for a player that could not reach the one picked. */
export const useReprobe = (): (() => void) => {
  const reprobe = useOriginProbe((state) => state.reprobe)
  if (reprobe === null) {
    throw new Error('useReprobe needs a MediaOriginProbe around it')
  }
  return reprobe
}
