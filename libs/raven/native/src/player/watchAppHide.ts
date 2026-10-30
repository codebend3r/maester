import type { WatchHide } from '@raven/ui/headless'
import { AppState } from 'react-native'

import { APP_STATE_EVENTS, isForegroundState } from '@/servers/eventSource'

/** Saves the spot when the app goes to the background, as a page hidden does on the web. */
export const watchAppHide: WatchHide = (save) => {
  const subscription = AppState.addEventListener(APP_STATE_EVENTS.change, (state) => {
    if (!isForegroundState(state)) save()
  })
  return () => subscription.remove()
}
