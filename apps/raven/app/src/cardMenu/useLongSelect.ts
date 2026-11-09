import { useEffect, useRef } from 'react'
import { TVEventHandler } from 'react-native'

import { LONG_PRESS_NAMES } from '@/layouts/remoteKeys'

type UseLongSelectProps = { isListening: boolean; onLongSelect: () => void }

/**
 * Hears the remote's select held down, the fork's `longSelect`, while `isListening`. Only the
 * focused card listens, so a screen of cards holds one listener, never one per card. The fork
 * names a held select twice, as it begins and as it ends (on Android TV as the key goes down
 * and comes up), so a caller that stops listening on the first hears the second not at all.
 */
export const useLongSelect = ({ isListening, onLongSelect }: UseLongSelectProps): void => {
  const latest = useRef(onLongSelect)
  useEffect(() => {
    latest.current = onLongSelect
  })
  useEffect(() => {
    if (!isListening) return undefined
    const subscription = TVEventHandler.addListener((event) => {
      if (event.eventType === LONG_PRESS_NAMES.longSelect) latest.current()
    })
    return () => subscription.remove()
  }, [isListening])
}
