import { DESKTOP_REQUESTS } from '@raven/core'
import { useEffect, useRef } from 'react'
import type { DesktopClient } from '@/desktop/client'
import { handled } from '@/desktop/handled'

type UseLeaveSignalProps = {
  client: DesktopClient
  fileId: string | null
}

/**
 * Tells main the page left its file, so a deletion that waited for the player can run. React
 * runs this cleanup before the Player's, whose unmount saves where it was, so the leave waits
 * a turn for main to read that position first; StrictMode's remount in that turn takes it back.
 * The page that calls it is keyed by its file: a new file mounts a new page, since a rerun of
 * this effect for another file in the same page would take back the old file's leave. A null
 * `fileId`, a title playing from its server, has nothing to leave.
 */
export const useLeaveSignal = ({ client, fileId }: UseLeaveSignalProps): void => {
  const leaving = useRef<symbol | null>(null)
  useEffect(() => {
    leaving.current = null
    if (fileId === null) return
    return () => {
      const leave = Symbol('leave')
      leaving.current = leave
      queueMicrotask(() => {
        if (leaving.current !== leave) return
        handled(client.request({ type: DESKTOP_REQUESTS.playbackLeft, fileId }))
      })
    }
  }, [client, fileId])
}
