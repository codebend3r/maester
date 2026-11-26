import { useAudioQueue } from '@raven/ui/headless'
import { useTVEventHandler } from 'react-native'

import { queueActionOf } from '@/remote/remoteKeys'

/**
 * The remote's media keys, wherever its focus is: play and pause, and the skip keys a step
 * through the queue. Mounted once, above the routes.
 */
export const useMediaKeys = (): void => {
  useTVEventHandler((event) => {
    const action = queueActionOf(event)
    if (action !== null) useAudioQueue.getState()[action]()
  })
}
