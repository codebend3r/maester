import { useMediaOriginProbe } from '@raven/ui'
import { type ReactNode, createContext, useContext } from 'react'
import { api } from '@/lib/api'

/** Null outside `MediaOriginProbe`, which no page is. */
const MediaOriginProbeContext = createContext<(() => void) | null>(null)

/**
 * Probes the server's media origins as the app opens and as the network
 * changes, and hands `reprobe` to whatever plays media beneath it.
 */
export const MediaOriginProbe = ({ children }: { children: ReactNode }) => {
  const { reprobe } = useMediaOriginProbe({ api })
  return <MediaOriginProbeContext value={reprobe}>{children}</MediaOriginProbeContext>
}

/** Probes the origins again: for a player that could not reach the one picked. */
export const useReprobe = (): (() => void) => {
  const reprobe = useContext(MediaOriginProbeContext)
  if (reprobe === null) {
    throw new Error('useReprobe needs a MediaOriginProbe around it')
  }
  return reprobe
}
