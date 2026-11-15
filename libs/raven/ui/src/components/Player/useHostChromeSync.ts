import { useEffect, useEffectEvent } from 'react'
import type { HostChrome } from '@/components/Player/PlayerServices'

type UseHostChromeSyncProps = {
  chrome: HostChrome | null
  isShown: boolean
}

/** Tells the host when the controls show and hide, and that they show once the player goes. */
export const useHostChromeSync = ({ chrome, isShown }: UseHostChromeSyncProps): void => {
  const tellHost = useEffectEvent((isVisible: boolean) => {
    if (chrome === null) return
    chrome.shown(isVisible)
  })
  useEffect(() => {
    tellHost(isShown)
  }, [isShown])
  // The player going away leaves the host's own chrome as it should be.
  useEffect(() => () => tellHost(true), [])
}
