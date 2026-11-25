import { hasPlayingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useSegments } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type Chrome, chromeOf } from '@/shell/chrome'
import { type PageInsets, pageInsetsOf, toastOffsetOf } from '@/shell/pageInsets'
import { useFormFactor } from '@/theme/wrenTheme'

/** The chrome around the screen showing now. */
export const useChrome = (): Chrome => {
  const [screen = ''] = useSegments()
  return chromeOf({ screen })
}

/** Whether a track is queued, so the mini player or the tablet's player bar shows. */
const useHasPlayer = (): boolean => useAudioQueue(hasPlayingTrackOf)

/**
 * A page's padding: below the status bar, inside the phone's gutter or the tablet's margins,
 * and clear of the tab bar, the mini player or the player bar. Every screen spreads it into its
 * scroller's content style.
 */
export const usePageInsets = (): PageInsets => {
  const safe = useSafeAreaInsets()
  const formFactor = useFormFactor()
  const chrome = useChrome()
  const hasPlayer = useHasPlayer()
  return pageInsetsOf({ safe, formFactor, chrome, hasPlayer })
}

/** How far above the screen's foot a toast floats, clear of whichever bars show. */
export const useToastOffset = (): number => {
  const { bottom } = useSafeAreaInsets()
  const formFactor = useFormFactor()
  const chrome = useChrome()
  const hasPlayer = useHasPlayer()
  return toastOffsetOf({ formFactor, chrome, hasPlayer, safeBottom: bottom })
}
